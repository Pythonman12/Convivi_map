/**
 * 전국 편의점 지도 (Nationwide Convenience Store Map)
 * 대한민국 전역 54,446개 편의점 위치 & 브랜드별/지역별 검색
 * 완전 무료 지도 (국토교통부 VWorld + OpenStreetMap), API 키 불필요
 */

(function () {
  'use strict';

  // 1. 상태 관리 변수
  const state = {
    allStores: [],
    filteredStores: [],
    selectedBrand: 'ALL',
    selectedSido: '',
    selectedGu: '',
    keyword: '',
    userCoords: null, // { lat, lng }
    userMarker: null,
    currentTileIndex: 0,
    selectedStoreId: null,
    markersMap: new Map(), // id -> L.marker
    sidoGuMap: {}
  };

  // 브랜드 색상 및 스타일 정의
  const BRAND_CONFIG = {
    'CU': { color: '#652D90', text: 'CU', badgeClass: 'CU' },
    'GS25': { color: '#007BC4', text: 'GS', badgeClass: 'GS25' },
    '세븐일레븐': { color: '#0A7E3E', text: '7', badgeClass: '세븐일레븐' },
    '이마트24': { color: '#D97706', text: '24', badgeClass: '이마트24' },
    '미니스톱': { color: '#0369A1', text: 'M', badgeClass: '미니스톱' },
    '씨스페이스': { color: '#DC2626', text: 'C', badgeClass: '씨스페이스' },
    '스토리웨이': { color: '#2563EB', text: 'S', badgeClass: '스토리웨이' },
    '기타': { color: '#475569', text: '🏪', badgeClass: '기타' }
  };

  // 100% 무료 지도 타일 레이어 (국토교통부 VWorld + 글로벌 OSM, Zoom 5~19 완벽 지원)
  const TILE_LAYERS = [
    {
      name: 'VWorld 대한민국 표준지도 (국토교통부)',
      url: 'https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.vworld.kr/" target="_blank">국토교통부 VWorld</a>',
      minZoom: 5,
      maxZoom: 19
    },
    {
      name: 'VWorld 모던 백지도 (마커 집중)',
      url: 'https://xdworld.vworld.kr/2d/white/service/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.vworld.kr/" target="_blank">국토교통부 VWorld</a>',
      minZoom: 5,
      maxZoom: 19
    },
    {
      name: 'OSM Humanitarian (선명한 오픈 지도)',
      url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, Tiles by <a href="https://www.hotosm.org/" target="_blank">HOT</a>',
      minZoom: 5,
      maxZoom: 18
    },
    {
      name: 'OpenStreetMap DE (글로벌 고속 미러)',
      url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
      minZoom: 5,
      maxZoom: 19
    }
  ];

  // 대한민국 중심 좌표 & 전국 뷰
  const KOREA_CENTER = [36.2, 127.8];
  const KOREA_DEFAULT_ZOOM = 7;

  // DOM 요소 캐시
  const elements = {
    map: null,
    markerClusterGroup: null,
    tileLayer: null,
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    sidoSelect: document.getElementById('sidoSelect'),
    guSelect: document.getElementById('guSelect'),
    geoBtn: document.getElementById('geoBtn'),
    mobileGeoBtn: document.getElementById('mobileGeoBtn'),
    brandChips: document.getElementById('brandChips'),
    matchCount: document.getElementById('matchCount'),
    mobileListCount: document.getElementById('mobileListCount'),
    resetFilterBtn: document.getElementById('resetFilterBtn'),
    storeList: document.getElementById('storeList'),
    sidebar: document.getElementById('sidebar'),
    closeSidebarBtn: document.getElementById('closeSidebarBtn'),
    mobileSearchTrigger: document.getElementById('mobileSearchTrigger'),
    mobileSearchText: document.getElementById('mobileSearchText'),
    mobileSheetHandle: document.getElementById('mobileSheetHandle'),
    sheetChevron: document.getElementById('sheetChevron'),
    mapResetViewBtn: document.getElementById('mapResetViewBtn'),
    toggleTileBtn: document.getElementById('toggleTileBtn'),
    toast: document.getElementById('toast')
  };

  // 2. 초기화 함수
  function init() {
    // 데이터 로드 확인
    if (typeof NATIONWIDE_CONVENIENCE_STORES !== 'undefined' && Array.isArray(NATIONWIDE_CONVENIENCE_STORES)) {
      state.allStores = NATIONWIDE_CONVENIENCE_STORES;
    } else if (typeof BUSAN_CONVENIENCE_STORES !== 'undefined' && Array.isArray(BUSAN_CONVENIENCE_STORES)) {
      state.allStores = BUSAN_CONVENIENCE_STORES;
    } else {
      console.error('stores-data.js 파일이 로드되지 않았습니다.');
      showToast('편의점 데이터를 불러오는 데 실패했습니다.');
      return;
    }

    if (typeof KOREA_SIDO_GU_MAP !== 'undefined') {
      state.sidoGuMap = KOREA_SIDO_GU_MAP;
    }

    initMap();
    setupEventListeners();
    updateBrandCounts();
    applyFilters(false);
  }

  // 3. Leaflet 무료 지도 초기화 (전국 축소 확대 지원: minZoom 5 ~ maxZoom 19)
  function initMap() {
    elements.map = L.map('map', {
      center: KOREA_CENTER,
      zoom: KOREA_DEFAULT_ZOOM,
      zoomControl: true,
      minZoom: 5, // 전국 및 동해/서해/제주도 전체 축소 가능
      maxZoom: 19
    });

    // 기본 타일 레이어 추가
    const defaultTile = TILE_LAYERS[0];
    elements.tileLayer = L.tileLayer(defaultTile.url, {
      attribution: defaultTile.attribution,
      minZoom: defaultTile.minZoom || 5,
      maxZoom: defaultTile.maxZoom || 19
    }).addTo(elements.map);

    // 5만 개 대용량 마커 고속 클러스터 그룹 초기화
    elements.markerClusterGroup = L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 100,
      chunkDelay: 20,
      maxClusterRadius: 65,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true
    });
    elements.map.addLayer(elements.markerClusterGroup);
  }

  // 4. 이벤트 리스너 등록
  function setupEventListeners() {
    // 검색창 입력 이벤트 (디바운스)
    let searchTimeout = null;
    elements.searchInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      state.keyword = val;
      elements.clearSearchBtn.style.display = val ? 'block' : 'none';
      
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        applyFilters(false);
      }, 200);
    });

    // 검색어 초기화 버튼
    elements.clearSearchBtn.addEventListener('click', () => {
      elements.searchInput.value = '';
      state.keyword = '';
      elements.clearSearchBtn.style.display = 'none';
      applyFilters(false);
      elements.searchInput.focus();
    });

    // 시/도 선택 드롭다운 (1차 필터)
    if (elements.sidoSelect) {
      elements.sidoSelect.addEventListener('change', (e) => {
        state.selectedSido = e.target.value;
        state.selectedGu = ''; // 시/도 변경 시 구/군 리셋
        updateGuDropdown(state.selectedSido);
        applyFilters(true);
      });
    }

    // 구/군 선택 드롭다운 (2차 필터)
    if (elements.guSelect) {
      elements.guSelect.addEventListener('change', (e) => {
        state.selectedGu = e.target.value;
        applyFilters(true);
      });
    }

    // 브랜드 필터 칩 클릭
    elements.brandChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      
      const brand = chip.getAttribute('data-brand');
      if (!brand) return;

      document.querySelectorAll('#brandChips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      state.selectedBrand = brand;
      applyFilters(false);
    });

    // 필터 초기화 버튼
    elements.resetFilterBtn.addEventListener('click', resetAllFilters);

    // 내 위치 버튼 (데스크톱 & 모바일)
    elements.geoBtn.addEventListener('click', handleGeolocation);
    elements.mobileGeoBtn.addEventListener('click', handleGeolocation);

    // 모바일 UI 토글
    elements.mobileSearchTrigger.addEventListener('click', () => {
      elements.sidebar.classList.add('open');
      elements.searchInput.focus();
    });

    elements.closeSidebarBtn.addEventListener('click', () => {
      elements.sidebar.classList.remove('open');
    });

    elements.mobileSheetHandle.addEventListener('click', () => {
      elements.sidebar.classList.toggle('open');
    });

    // 전국 전체보기 버튼
    elements.mapResetViewBtn.addEventListener('click', () => {
      elements.map.setView(KOREA_CENTER, KOREA_DEFAULT_ZOOM);
    });

    // 지도 타일 스타일 변경 토글
    elements.toggleTileBtn.addEventListener('click', toggleMapStyle);
  }

  // 시/도 변경에 따른 구/군 드롭다운 동적 생성
  function updateGuDropdown(sidoName) {
    if (!elements.guSelect) return;
    elements.guSelect.innerHTML = '<option value="">시·군·구 전체</option>';

    if (!sidoName || !state.sidoGuMap[sidoName]) {
      return;
    }

    const gus = state.sidoGuMap[sidoName];
    gus.forEach(gu => {
      const opt = document.createElement('option');
      opt.value = gu;
      opt.textContent = gu;
      elements.guSelect.appendChild(opt);
    });
  }

  // 5. 필터링 및 렌더링 파이프라인
  function applyFilters(shouldFitBounds = false) {
    const brand = state.selectedBrand;
    const sido = state.selectedSido;
    const gu = state.selectedGu;
    const keyword = state.keyword.toLowerCase();

    state.filteredStores = state.allStores.filter(store => {
      // 1. 브랜드 조건
      if (brand !== 'ALL') {
        if (store.brand !== brand) return false;
      }

      // 2. 시/도 조건
      if (sido) {
        if (store.sido !== sido) return false;
      }

      // 3. 구/군 조건
      if (gu) {
        if (store.gu !== gu) return false;
      }

      // 4. 키워드 조건 (상호명, 지점명, 도로명주소, 동이름 등)
      if (keyword) {
        const targetText = `${store.name} ${store.branch || ''} ${store.sido || ''} ${store.gu || ''} ${store.addr || ''} ${store.dong || ''}`.toLowerCase();
        if (!targetText.includes(keyword)) return false;
      }

      return true;
    });

    // 내 위치가 있는 경우 거리 계산 및 가까운 순 정렬
    if (state.userCoords) {
      state.filteredStores.forEach(s => {
        s.distance = getDistanceKm(state.userCoords.lat, state.userCoords.lng, s.lat, s.lng);
      });
      state.filteredStores.sort((a, b) => a.distance - b.distance);
    }

    // 통계 및 텍스트 갱신
    const count = state.filteredStores.length;
    elements.matchCount.textContent = count.toLocaleString();
    elements.mobileListCount.textContent = count.toLocaleString();
    
    let filterLabel = sido ? (gu ? `${sido} ${gu}` : sido) : '';
    if (brand !== 'ALL') filterLabel += (filterLabel ? ' · ' : '') + brand;
    if (keyword) filterLabel += (filterLabel ? ' · ' : '') + keyword;
    elements.mobileSearchText.textContent = filterLabel || '전국 편의점 검색 및 필터';

    renderMarkers(shouldFitBounds);
    renderStoreList();
  }

  // 6. 마커 생성 및 클러스터링
  function renderMarkers(shouldFitBounds) {
    elements.markerClusterGroup.clearLayers();
    state.markersMap.clear();

    const markers = [];
    const bounds = L.latLngBounds();

    state.filteredStores.forEach(store => {
      const brandInfo = BRAND_CONFIG[store.brand] || BRAND_CONFIG['기타'];
      
      const customIcon = L.divIcon({
        className: 'custom-pin-container',
        html: `
          <div class="custom-pin" style="background-color: ${brandInfo.color};">
            <span class="custom-pin-inner">${brandInfo.text}</span>
          </div>
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -28]
      });

      const marker = L.marker([store.lat, store.lng], { icon: customIcon });
      
      // 팝업 내용 지연 바인딩
      marker.bindPopup(() => createPopupContent(store));

      // 마커 클릭 시 리스트 하이라이트
      marker.on('click', () => {
        highlightStoreCard(store.id);
      });

      markers.push(marker);
      state.markersMap.set(store.id, marker);
      bounds.extend([store.lat, store.lng]);
    });

    elements.markerClusterGroup.addLayers(markers);

    // 영역 피팅 (특정 시/도, 구/군, 키워드 검색 시에만)
    if (shouldFitBounds && markers.length > 0) {
      elements.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }

  // 7. 점포 상세 팝업 HTML 생성
  function createPopupContent(store) {
    const brandInfo = BRAND_CONFIG[store.brand] || BRAND_CONFIG['기타'];
    const displayName = store.name;
    const branchText = store.branch ? ` (${store.branch})` : '';
    const distanceBadge = store.distance !== undefined ? 
      `<span style="color: #2563EB; font-weight: 700; font-size: 0.8rem;">📍 ${formatDistance(store.distance)}</span>` : '';

    const kakaoMapUrl = `https://map.kakao.com/link/to/${encodeURIComponent(store.name)},${store.lat},${store.lng}`;
    const naverMapUrl = `https://map.naver.com/v5/search/${encodeURIComponent(store.name + ' ' + (store.branch || ''))}`;

    const escapedAddr = (store.addr || '').replace(/'/g, "\\'");

    return `
      <div class="popup-card">
        <div class="popup-header">
          <span class="brand-badge ${brandInfo.badgeClass}">${store.brand}</span>
          ${distanceBadge}
        </div>
        <h3 class="popup-title">${displayName}${branchText}</h3>
        <p class="popup-addr">📍 ${store.addr}</p>
        <div class="popup-actions">
          <a href="${kakaoMapUrl}" target="_blank" rel="noopener noreferrer" class="popup-btn popup-btn-kakao">
            카카오 길찾기
          </a>
          <a href="${naverMapUrl}" target="_blank" rel="noopener noreferrer" class="popup-btn popup-btn-naver">
            네이버 지도
          </a>
          <button class="popup-btn popup-copy-btn" onclick="window.copyAddress('${escapedAddr}')">
            📋 주소 복사하기
          </button>
        </div>
      </div>
    `;
  }

  // 8. 매장 리스트 렌더링 (사이드바)
  function renderStoreList() {
    const container = elements.storeList;
    container.innerHTML = '';

    if (state.filteredStores.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>🔍 조건에 일치하는 편의점이 없습니다.</p>
          <p style="font-size: 0.8rem; margin-top: 6px;">다른 지역이나 브랜드를 선택해 보세요.</p>
        </div>
      `;
      return;
    }

    // 렌더링 성능을 위해 상위 120개 점포 렌더링
    const displayList = state.filteredStores.slice(0, 120);
    const fragment = document.createDocumentFragment();

    displayList.forEach(store => {
      const card = document.createElement('div');
      card.className = 'store-card';
      card.id = `card-${store.id}`;
      if (state.selectedStoreId === store.id) card.classList.add('selected');

      const brandInfo = BRAND_CONFIG[store.brand] || BRAND_CONFIG['기타'];
      const branchHtml = store.branch ? `<span class="card-branch">${store.branch}</span>` : '';
      const distHtml = store.distance !== undefined ? 
        `<span class="card-distance">${formatDistance(store.distance)}</span>` : '';

      const locationTag = `${store.sido ? store.sido.slice(0, 2) + ' ' : ''}${store.gu || ''} ${store.dong || ''}`.trim();

      card.innerHTML = `
        <div class="card-top">
          <span class="brand-badge ${brandInfo.badgeClass}">${store.brand}</span>
          ${distHtml}
        </div>
        <div class="card-name">${store.name}${branchHtml}</div>
        <div class="card-addr">${store.addr}</div>
        <div class="card-footer">
          <span class="card-district-tag">${locationTag}</span>
          <span>상세보기 &rarr;</span>
        </div>
      `;

      card.addEventListener('click', () => {
        selectStore(store);
      });

      fragment.appendChild(card);
    });

    container.appendChild(fragment);

    if (state.filteredStores.length > 120) {
      const notice = document.createElement('div');
      notice.style.cssText = 'text-align:center; padding:12px; font-size:0.8rem; color:#64748B;';
      notice.textContent = `(전체 ${state.filteredStores.length.toLocaleString()}개 중 상위 120개를 표시합니다. 지도를 확대하거나 지역을 선택하면 더 상세히 볼 수 있습니다)`;
      container.appendChild(notice);
    }
  }

  // 9. 특정 매장 선택 시 지도 포커스 및 팝업 오픈
  function selectStore(store) {
    state.selectedStoreId = store.id;
    highlightStoreCard(store.id);

    if (window.innerWidth <= 900) {
      elements.sidebar.classList.remove('open');
    }

    const marker = state.markersMap.get(store.id);
    if (marker) {
      elements.map.setView([store.lat, store.lng], 17, { animate: true });
      setTimeout(() => {
        elements.markerClusterGroup.zoomToShowLayer(marker, () => {
          marker.openPopup();
        });
      }, 250);
    }
  }

  function highlightStoreCard(storeId) {
    state.selectedStoreId = storeId;
    document.querySelectorAll('.store-card').forEach(c => c.classList.remove('selected'));
    const card = document.getElementById(`card-${storeId}`);
    if (card) {
      card.classList.add('selected');
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // 10. 브랜드 카운트 초기 통계 계산
  function updateBrandCounts() {
    const counts = { ALL: state.allStores.length };
    state.allStores.forEach(s => {
      counts[s.brand] = (counts[s.brand] || 0) + 1;
    });

    const setBadge = (id, count) => {
      const el = document.getElementById(id);
      if (el) el.textContent = (count || 0).toLocaleString();
    };

    setBadge('countALL', counts['ALL']);
    setBadge('countCU', counts['CU']);
    setBadge('countGS25', counts['GS25']);
    setBadge('count711', counts['세븐일레븐']);
    setBadge('countEmart24', counts['이마트24']);
    setBadge('countMinistop', counts['미니스톱']);
    setBadge('countCspace', counts['씨스페이스']);
    setBadge('countOther', counts['기타']);
  }

  // 11. Geolocation (내 위치 찾기)
  function handleGeolocation() {
    if (!navigator.geolocation) {
      showToast('이 브라우저는 위치 정보(GPS)를 지원하지 않습니다.');
      return;
    }

    showToast('현재 위치를 확인하고 있습니다...');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        state.userCoords = { lat, lng };

        if (state.userMarker) {
          elements.map.removeLayer(state.userMarker);
        }

        const userIcon = L.divIcon({
          className: 'user-geo-marker',
          html: `<div style="background:#2563EB; width:16px; height:16px; border-radius:50%; border:3px solid white; box-shadow:0 0 10px rgba(37,99,235,0.7);"></div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });

        state.userMarker = L.marker([lat, lng], { icon: userIcon }).addTo(elements.map);
        state.userMarker.bindPopup('<b>현재 내 위치</b>').openPopup();

        elements.geoBtn.classList.add('active');
        showToast('내 위치 주변 편의점을 가까운 순으로 정렬했습니다.');

        applyFilters(false);
        elements.map.setView([lat, lng], 15, { animate: true });
      },
      (err) => {
        console.warn('Geolocation error:', err);
        showToast('위치 정보 접근 권한이 거부되었거나 위치를 가져올 수 없습니다.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // 12. 전체 필터 초기화
  function resetAllFilters() {
    state.selectedBrand = 'ALL';
    state.selectedSido = '';
    state.selectedGu = '';
    state.keyword = '';
    state.selectedStoreId = null;

    elements.searchInput.value = '';
    elements.clearSearchBtn.style.display = 'none';
    if (elements.sidoSelect) elements.sidoSelect.value = '';
    if (elements.guSelect) {
      elements.guSelect.innerHTML = '<option value="">시·군·구 전체</option>';
      elements.guSelect.value = '';
    }

    document.querySelectorAll('#brandChips .chip').forEach(c => c.classList.remove('active'));
    const allChip = document.querySelector('#brandChips [data-brand="ALL"]');
    if (allChip) allChip.classList.add('active');

    applyFilters(false);
    elements.map.setView(KOREA_CENTER, KOREA_DEFAULT_ZOOM);
    showToast('전국 전체 보기로 초기화되었습니다.');
  }

  // 13. 지도 타일 스타일 토글
  function toggleMapStyle() {
    state.currentTileIndex = (state.currentTileIndex + 1) % TILE_LAYERS.length;
    const layerConf = TILE_LAYERS[state.currentTileIndex];

    elements.map.removeLayer(elements.tileLayer);
    elements.tileLayer = L.tileLayer(layerConf.url, {
      attribution: layerConf.attribution,
      minZoom: layerConf.minZoom || 5,
      maxZoom: layerConf.maxZoom || 19
    }).addTo(elements.map);

    showToast(`지도 스타일: ${layerConf.name}`);
  }

  // 14. 유틸리티 함수
  function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // 지구 반경 (km)
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function deg2rad(deg) {
    return deg * (Math.PI / 180);
  }

  function formatDistance(distKm) {
    if (distKm < 1) {
      return `${Math.round(distKm * 1000)}m`;
    }
    return `${distKm.toFixed(1)}km`;
  }

  function showToast(msg) {
    const toast = elements.toast;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2400);
  }

  // 전역 클립보드 복사 함수
  window.copyAddress = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('주소가 클립보드에 복사되었습니다! 📋');
      }).catch(() => {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  };

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showToast('주소가 클립보드에 복사되었습니다! 📋');
    } catch (e) {
      showToast('주소 복사에 실패했습니다.');
    }
    document.body.removeChild(textarea);
  }

  // DOM 로드 완료 후 실행
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
