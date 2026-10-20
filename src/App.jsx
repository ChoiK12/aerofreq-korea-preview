
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  ZoomControl,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import airports from './data/kr/airports.json';
import frequencies from './data/kr/frequencies.json';
import './App.css';

const initialLayers = [
  { id: 'airports', label: '공항', detail: 'Airports', symbol: '✈' },
  { id: 'airspaces', label: '항공 구역', detail: 'Airspaces', symbol: '⬡' },
  { id: 'routes', label: 'IFR 항로', detail: 'ATS Routes', symbol: '⌁' },
  { id: 'waypoints', label: 'FIX / 웨이포인트', detail: 'Waypoints', symbol: '⊙' },
  { id: 'navaids', label: '항행 시설', detail: 'Navaids', symbol: '⌖' },
];

const airportIcon = L.divIcon({
  className: '',
  html: `
    <div style="
      width: 29px;
      height: 29px;
      border-radius: 50% 50% 50% 0;
      background: #58a6ff;
      border: 2px solid #ffffff;
      box-shadow: 0 2px 12px #0009;
      transform: rotate(-45deg);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <span style="
        color: #071625;
        font-size: 16px;
        transform: rotate(45deg);
      ">✈</span>
    </div>
  `,
  iconSize: [29, 29],
  iconAnchor: [14, 29],
  popupAnchor: [0, -28],
});

function MoveToAirport({ airport }) {
  const map = useMap();

  useEffect(() => {
    if (airport) {
      map.flyTo(
        [Number(airport.latitude), Number(airport.longitude)],
        10,
        { duration: 0.8 }
      );
    }
  }, [airport, map]);

  return null;
}


// 관제 업무 코드 표기 차이를 통일합니다. 미등록 코드는 그대로 그룹으로 표시합니다.
const SERVICE_ALIASES = {
  TOWER: 'TWR', GROUND: 'GND', DELIVERY: 'DEL',
  APPROACH: 'APP', DEPARTURE: 'DEP',
  CLEARANCE: 'DEL', 'CLEARANCE DELIVERY': 'DEL',
};
const SERVICE_NAMES = {
  TWR: 'Tower', GND: 'Ground', DEL: 'Delivery',
  APP: 'Approach', DEP: 'Departure', ATIS: 'ATIS',
  APRON: 'Apron', ACC: 'Area Control', FSS: 'Flight Service',
  AFIS: 'Aerodrome Flight Information', OTHER: 'Other',
};
const SERVICE_ORDER = ['DEL', 'GND', 'APRON', 'TWR', 'DEP', 'APP', 'ACC', 'ATIS', 'FSS', 'AFIS', 'OTHER'];

function serviceCode(frequency) {
  const raw = String(frequency.service_code || 'OTHER').trim().toUpperCase();
  return SERVICE_ALIASES[raw] || raw || 'OTHER';
}

function FrequencyCard({ frequency }) {
  const value = Number(frequency.frequency_mhz);
  return (
    <div className="frequency-item">
      <div className="frequency-item-top">
        <span className="frequency-service">{serviceCode(frequency)}</span>
        <span className="frequency-value">
          {Number.isFinite(value) && value > 0 ? value.toFixed(3) : '—'}
          <small> MHz</small>
        </span>
      </div>
      <div className="frequency-callsign">
        {frequency.call_sign || '호출부호 미등록'}
      </div>
      {frequency.hours_of_operation && (
        <div className="frequency-meta">
          운영시간: {frequency.hours_of_operation}
        </div>
      )}
      {frequency.remarks && (
        <div className="frequency-remarks">{frequency.remarks}</div>
      )}
    </div>
  );
}

function App() {
  const [search, setSearch] = useState('');
  const [activeLayers, setActiveLayers] = useState(
    initialLayers.map((layer) => layer.id)
  );
  const [selectedIcao, setSelectedIcao] = useState(null);
  const [showAllFrequencies, setShowAllFrequencies] = useState(false);
  const [frequencyView, setFrequencyView] = useState('group');
  const [expandedServices, setExpandedServices] = useState([]);
  const [altitude, setAltitude] = useState('all');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const detailsScrollRef = useRef(null);
  const swipeStartY = useRef(null);

  useEffect(() => {
    if (!mobileDetailsOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, [mobileDetailsOpen]);

  const validAirports = useMemo(
    () =>
      airports.filter(
        (airport) =>
          airport.icao &&
          Number.isFinite(Number(airport.latitude)) &&
          Number.isFinite(Number(airport.longitude)) &&
          airport.latitude !== null &&
          airport.longitude !== null &&
          airport.latitude !== '' &&
          airport.longitude !== ''
      ),
    []
  );

  const selectedAirport =
    validAirports.find((airport) => airport.icao === selectedIcao) || null;

  const selectedFrequencies = useMemo(() => {
    if (!selectedIcao) return [];

    return frequencies.filter(
    (frequency) => frequency.icao === selectedIcao
    );
  }, [selectedIcao]);

  // 엑셀에서 기본 표시(Y)로 지정한 주파수를 먼저 보여 줍니다.
  const defaultFrequencies = selectedFrequencies.filter(
    (frequency) =>
      frequency.default_display === true ||
      String(frequency.default_display).toUpperCase() === 'Y'
  );

  // 지정이 없다면 첫 번째 기록을 임시로 표시합니다 (실제 주사용 의미 아님).
  const visibleFrequencies = showAllFrequencies
    ? selectedFrequencies
    : defaultFrequencies.length > 0
      ? defaultFrequencies
      : selectedFrequencies.slice(0, 1);

  const hasHiddenFrequencies =
    selectedFrequencies.length > visibleFrequencies.length;

  const frequencyGroups = useMemo(() => {
    const grouped = new Map();
    selectedFrequencies.forEach((frequency) => {
      const code = serviceCode(frequency);
      if (!grouped.has(code)) grouped.set(code, []);
      grouped.get(code).push(frequency);
    });
    return [...grouped.entries()]
      .sort(([a], [b]) => {
        const aOrder = SERVICE_ORDER.indexOf(a);
        const bOrder = SERVICE_ORDER.indexOf(b);
        return (aOrder < 0 ? 999 : aOrder) - (bOrder < 0 ? 999 : bOrder)
          || a.localeCompare(b);
      })
      .map(([code, items]) => ({ code, items }));
  }, [selectedFrequencies]);

  const filteredAirports = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return validAirports;

    return validAirports.filter((airport) =>
      [
        airport.icao,
        airport.iata,
        airport.name_ko,
        airport.name_en,
      ].some((value) =>
        String(value || '').toLowerCase().includes(query)
      )
    );
  }, [search, validAirports]);

  const toggleLayer = (id) => {
    setActiveLayers((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  };

  const selectAirport = (airport) => {
    setSelectedIcao(airport.icao);
    setShowAllFrequencies(false);
    setExpandedServices([]);
    setSidebarOpen(false);
    setMobileDetailsOpen(true);
    if (detailsScrollRef.current) detailsScrollRef.current.scrollTop = 0;
  };

  const closeDetails = () => {
    setMobileDetailsOpen(false);
    setSelectedIcao(null);
    setShowAllFrequencies(false);
    setExpandedServices([]);
  };

  const startSwipe = (event) => {
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    swipeStartY.current = event.touches[0]?.clientY ?? null;
  };

  const endSwipe = (event) => {
    if (!window.matchMedia('(max-width: 768px)').matches || swipeStartY.current === null) return;
    const distance = (event.changedTouches[0]?.clientY ?? swipeStartY.current) - swipeStartY.current;
    swipeStartY.current = null;
    if (distance > 90 && (detailsScrollRef.current?.scrollTop ?? 0) <= 1) closeDetails();
  };

  return (
    <main className={`app-shell ${mobileDetailsOpen ? "mobile-modal-active" : ""}`}>
      <header className="topbar">
        <button
          className="mobile-menu"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="메뉴 열기 또는 닫기"
        >
          ☰
        </button>

        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">
              AERO<span>FREQ</span>
            </div>
            <div className="brand-subtitle">
              AVIATION INFORMATION MAP
            </div>
          </div>
        </div>

        <div className="topbar-center">
          <span className="status-dot" />
          <span>KOREA REGION</span>
          <span className="topbar-divider">/</span>
          <span className="muted">EXPLORER MODE</span>
        </div>

        <div className="topbar-right">
          <span className="version-label">BETA</span>
          <div className="topbar-coordinate">
            36°30′N · 127°30′E
          </div>
        </div>
      </header>

      <div className="workspace">
        <aside className={`sidebar ${sidebarOpen ? '' : 'sidebar-hidden'}`}>
          <div className="sidebar-heading">
            <div>
              <div className="eyebrow">NAVIGATION</div>
              <h1>항공 정보 탐색</h1>
            </div>
            <span className="heading-icon">⌕</span>
          </div>

          <div className="search-box">
            <span className="search-icon">⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="공항명, ICAO, IATA 검색"
              aria-label="공항 검색"
            />
            <span className="search-shortcut">/</span>
          </div>

          <div className="search-hint">
            공항명 · ICAO 코드 · IATA 코드
          </div>

          {search.trim() && (
            <div style={{ marginTop: 12, marginBottom: 18 }}>
              <div className="section-heading">
                <span>SEARCH RESULTS</span>
                <span className="section-count">
                  {filteredAirports.length}
                </span>
              </div>

              {filteredAirports.map((airport) => (
                <button
                  key={airport.icao}
                  className="layer-row"
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => selectAirport(airport)}
                >
                  <span className="layer-symbol">✈</span>
                  <span className="layer-labels">
                    <span className="layer-name">
                      {airport.name_ko}
                    </span>
                    <span className="layer-detail">
                      {airport.icao} · {airport.iata || '—'}
                    </span>
                  </span>
                </button>
              ))}

              {filteredAirports.length === 0 && (
                <p className="search-hint">검색 결과가 없습니다.</p>
              )}
            </div>
          )}

          <div className="section-heading">
            <span>MAP LAYERS</span>
            <span className="section-count">
              {activeLayers.length.toString().padStart(2, '0')}
            </span>
          </div>

          <div className="layer-list">
            {initialLayers.map((layer) => {
              const enabled = activeLayers.includes(layer.id);

              return (
                <button
                  key={layer.id}
                  className={`layer-row ${
                    enabled ? 'layer-active' : ''
                  }`}
                  onClick={() => toggleLayer(layer.id)}
                  aria-pressed={enabled}
                >
                  <span className="layer-symbol">
                    {layer.symbol}
                  </span>
                  <span className="layer-labels">
                    <span className="layer-name">
                      {layer.label}
                    </span>
                    <span className="layer-detail">
                      {layer.detail}
                    </span>
                  </span>
                  <span className={`toggle ${
                    enabled ? 'toggle-on' : ''
                  }`}>
                    <span />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="sidebar-divider" />

          <div className="section-heading">
            <span>ALTITUDE FILTER</span>
            <span className="section-count">FT</span>
          </div>

          <div className="altitude-options">
            {[
              { value: 'all', label: '전체 고도', sub: 'ALL LEVELS' },
              { value: 'low', label: '저고도', sub: 'LOW LEVEL' },
              { value: 'high', label: '고고도', sub: 'HIGH LEVEL' },
            ].map((option) => (
              <button
                key={option.value}
                className={`altitude-option ${
                  altitude === option.value
                    ? 'altitude-selected'
                    : ''
                }`}
                onClick={() => setAltitude(option.value)}
              >
                <span className="altitude-radio">
                  {altitude === option.value && <span />}
                </span>
                <span>
                  <span className="altitude-label">
                    {option.label}
                  </span>
                  <span className="altitude-sub">
                    {option.sub}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="sidebar-spacer" />

          <div className="data-status">
            <div className="data-status-icon">i</div>
            <div>
              <div className="data-status-title">
                공항 데이터 연결됨
              </div>
              <div className="data-status-text">
                공항 {validAirports.length}곳 · 주파수 {frequencies.length}개 연결됨
              </div>
            </div>
          </div>

          <div className="sidebar-footer">
            <span>DATA-DRIVEN AVIATION MAP</span>
            <span>v0.2.0</span>
          </div>
        </aside>

        <section className="map-area">
          <MapContainer
            center={[36.5, 127.8]}
            zoom={7}
            minZoom={5}
            maxZoom={15}
            zoomControl={false}
            className="leaflet-map"
            worldCopyJump={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url={`https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${import.meta.env.VITE_CARTO_API_KEY}`}
            />

            <ZoomControl position="bottomright" />

            <MoveToAirport airport={selectedAirport} />

            {activeLayers.includes('airports') &&
              filteredAirports.map((airport) => (
                <Marker
                  key={airport.icao}
                  position={[
                    Number(airport.latitude),
                    Number(airport.longitude),
                  ]}
                  icon={airportIcon}
                >
                  <Popup>
                    <strong>{airport.name_ko}</strong>
                    <div>{airport.name_en}</div>
                    <div>
                      {airport.icao} / {airport.iata || '—'}
                    </div>
                    <button
                      onClick={() => selectAirport(airport)}
                      style={{ marginTop: 8, cursor: 'pointer' }}
                    >
                      상세 정보
                    </button>
                  </Popup>
                </Marker>
              ))}
          </MapContainer>

          <div className="map-top-label">
            <span className="map-label-dot" />
            <span>REPUBLIC OF KOREA</span>
            <span className="map-label-separator">/</span>
            <span className="map-label-muted">SOUTH KOREA</span>
          </div>

          <div className="map-tools">
            <button
              className="map-tool"
              title="전체 레이어 켜기"
              onClick={() =>
                setActiveLayers(initialLayers.map((layer) => layer.id))
              }
            >
              <span>▤</span>
              <span className="map-tool-label">레이어 전체</span>
            </button>

            <button
              className="map-tool"
              title="레이어 모두 끄기"
              onClick={() => setActiveLayers([])}
            >
              <span>◌</span>
              <span className="map-tool-label">초기화</span>
            </button>
          </div>

          <div className="map-scale-card">
            <div className="scale-title">AIRPORT DATA</div>
            <div className="scale-value">
              {validAirports.length} AIRPORTS
            </div>
            <div className="scale-caption">KOREA REGION</div>
          </div>

          <div className="map-bottom-note">
            <span className="bottom-note-dot" />
            <span>MAP DATA © OPENSTREETMAP · CARTO</span>
          </div>
        </section>

        <aside className={`details-panel ${mobileDetailsOpen && selectedAirport ? 'mobile-details-open' : ''}`}>
          <div className="details-header mobile-swipe-handle" onTouchStart={startSwipe} onTouchEnd={endSwipe} onTouchCancel={() => { swipeStartY.current = null; }}>
            {selectedAirport && <div className="mobile-drag-indicator" aria-hidden="true" />}
            {selectedAirport && <button type="button" className="mobile-details-close" onClick={closeDetails} aria-label="상세 정보 닫기">×</button>}
            <div className="eyebrow">INFORMATION</div>
            <h2>항공 정보</h2>
            <p>
              지도에서 공항을 선택하면 상세 정보가 표시됩니다.
            </p>
          </div>

          {selectedAirport ? (
            <div ref={detailsScrollRef} className="airport-detail-content" style={{ padding: '22px', overflowY: 'auto' }}>
              <div className="eyebrow">SELECTED AIRPORT</div>

              <h2 style={{ marginTop: 10, marginBottom: 6 }}>
                {selectedAirport.name_ko}
              </h2>

              <p style={{ opacity: 0.65, marginBottom: 24 }}>
                {selectedAirport.name_en}
              </p>

              {[
                ['ICAO', selectedAirport.icao],
                ['IATA', selectedAirport.iata || '미등록'],
                ['위도', `${Number(selectedAirport.latitude).toFixed(6)}°`],
                ['경도', `${Number(selectedAirport.longitude).toFixed(6)}°`],
                ['공항 유형', selectedAirport.airport_type || '—'],
                ['운항 유형', selectedAirport.traffic_types || '—'],
              ].map(([label, value]) => (
                <div className="detail-stat" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}

              <div className="sidebar-divider" />

              <div className="section-heading">
                <span>FREQUENCIES</span>
              </div>

              <div className="frequency-section">
                <div className="frequency-view-switch" role="group" aria-label="주파수 표시 방식">
                  <button
                    type="button"
                    className={`frequency-view-button ${frequencyView === 'list' ? 'is-active' : ''}`}
                    aria-pressed={frequencyView === 'list'}
                    onClick={() => setFrequencyView('list')}
                  >
                    목록 보기
                  </button>
                  <button
                    type="button"
                    className={`frequency-view-button ${frequencyView === 'group' ? 'is-active' : ''}`}
                    aria-pressed={frequencyView === 'group'}
                    onClick={() => setFrequencyView('group')}
                  >
                    업무별 보기
                  </button>
                </div>

                {selectedFrequencies.length === 0 ? (
                  <p className="frequency-empty">등록된 주파수 정보가 없습니다.</p>
                ) : frequencyView === 'list' ? (
                  <>
                    <div className="frequency-list">
                      {visibleFrequencies.map((frequency, index) => (
                        <FrequencyCard
                          key={frequency.frequency_id || `${frequency.icao}-${index}`}
                          frequency={frequency}
                        />
                      ))}
                    </div>
                    {(hasHiddenFrequencies || showAllFrequencies) && (
                      <button
                        type="button"
                        className="frequency-expand-button"
                        aria-expanded={showAllFrequencies}
                        onClick={() => setShowAllFrequencies((current) => !current)}
                      >
                        {showAllFrequencies
                          ? '▲ 주파수 목록 접기'
                          : `▼ 전체 주파수 보기 (${selectedFrequencies.length}개)`}
                      </button>
                    )}
                    {!showAllFrequencies && defaultFrequencies.length === 0 && (
                      <p className="frequency-empty">
                        기본 표시 주파수가 지정되지 않아 첫 번째 기록만 임시 표시합니다.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="frequency-groups">
                    {frequencyGroups.map(({ code, items }) => {
                      const expanded = expandedServices.includes(code);
                      return (
                        <div className="frequency-group" key={code}>
                          <button
                            type="button"
                            className="frequency-group-trigger"
                            aria-expanded={expanded}
                            onClick={() => setExpandedServices((current) =>
                              current.includes(code)
                                ? current.filter((item) => item !== code)
                                : [...current, code]
                            )}
                          >
                            <span className="frequency-group-label">
                              <span className="frequency-service">{code}</span>
                              <span>{SERVICE_NAMES[code] || code}</span>
                            </span>
                            <span className="frequency-group-count">
                              {items.length}개 <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
                            </span>
                          </button>
                          {expanded && (
                            <div className="frequency-group-content frequency-list">
                              {items.map((frequency, index) => (
                                <FrequencyCard
                                  key={frequency.frequency_id || `${code}-${index}`}
                                  frequency={frequency}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <p className="frequency-disclaimer">
                  데이터 검증 진행 중 · 실제 항공 운항 및 관제 목적으로
                  사용하지 마세요.
                </p>
              </div>
              <button
                className="layer-row"
                style={{ width: '100%', marginTop: 20 }}
                onClick={closeDetails}
              >
                × 상세 정보 닫기
              </button>
            </div>
          ) : (
            <div className="details-empty">
              <div className="empty-illustration">
                <div className="empty-circle">
                  <span>⌖</span>
                </div>
                <div className="empty-orbit orbit-one" />
                <div className="empty-orbit orbit-two" />
              </div>

              <div className="empty-title">
                선택된 항목 없음
              </div>
              <div className="empty-description">
                지도에서 공항을 선택하거나 검색하여
                공항 정보를 확인할 수 있습니다.
              </div>
            </div>
          )}

          <div className="details-bottom">
            <div className="detail-stat">
              <span>등록 공항</span>
              <strong>{validAirports.length}</strong>
            </div>
            <div className="detail-stat">
              <span>활성 레이어</span>
              <strong>{activeLayers.length}</strong>
            </div>
            <div className="detail-stat">
              <span>고도 필터</span>
              <strong>
                {altitude === 'all'
                  ? '전체'
                  : altitude === 'low'
                    ? '저고도'
                    : '고고도'}
              </strong>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

export default App;
