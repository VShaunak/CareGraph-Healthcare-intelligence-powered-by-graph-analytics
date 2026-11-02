/**
 * CareGraph — Client-side Application Controller
 * Real-time healthcare discovery, triage routing, and topology graph analytics
 */

(function () {
  'use strict';

  const esc = (v) =>
    String(v || '').replace(
      /[&<>'"]/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#39;',
          '"': '&quot;',
        }[c])
    );

  const post = async (url, payload) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) {
      throw new Error(d.error || 'The live search request could not be completed.');
    }
    return d;
  };

  const setButton = (b, on, label) => {
    if (!b) return;
    b.disabled = on;
    const textEl = b.querySelector('.btn-text');
    if (textEl) {
      textEl.textContent = on ? 'Querying Live Sources...' : label;
    } else {
      b.innerHTML = on
        ? '<span class="material-symbols-outlined" style="animation:spin 1s linear infinite">sync</span> Querying Live Sources...'
        : `${label} &rarr;`;
    }
  };

  const link = (f) =>
    `/facility?${new URLSearchParams({
      name: f.name,
      city: f.city || '',
      state: f.state || '',
      osm_url: f.osm_url || '',
    }).toString()}`;

  function cards(items, recommend = false) {
    if (!items || !items.length) {
      return '<div class="google-empty-state"><p>No facilities met the active search criteria.</p></div>';
    }

    const longest = Math.max(...items.map((x) => x.travel?.minutes || 1));

    return items
      .map((f, i) => {
        const travelMins = f.travel?.minutes || 1;
        const bar = Math.max(12, Math.round((travelMins / longest) * 100));
        const isUrgent = f.kind === 'urgent_care';

        const kindBadge = isUrgent
          ? `<span class="facility-badge badge-urgent"><span class="material-symbols-outlined" style="font-size:14px">medical_services</span>Urgent Care</span>`
          : `<span class="facility-badge badge-hospital"><span class="material-symbols-outlined" style="font-size:14px">local_hospital</span>Hospital</span>`;

        const admission = isUrgent
          ? 'Hospital admission: not applicable'
          : 'ER admission probability: unverified by public live feeds';

        let scoreHtml = '';
        if (recommend) {
          if (f.access_score !== null && f.access_score !== undefined) {
            scoreHtml = `
              <div class="score-badge-card">
                <div>
                  <span class="score-title">Composite Access Score</span>
                  <div class="score-value">${esc(f.access_score)}</div>
                </div>
                <span class="chip chip-blue">Ranked</span>
              </div>`;
          } else {
            scoreHtml = `
              <div class="score-badge-card referral">
                <div>
                  <span class="score-title">Referral Listing Only</span>
                  <div class="score-value">No Certified CMS Measure</div>
                </div>
                <span class="chip chip-gray">Unranked</span>
              </div>`;
          }
        }

        let edMetric = '';
        if (recommend && f.historical_ed_minutes !== null && f.historical_ed_minutes !== undefined) {
          edMetric = `<span class="metric-chip"><strong>${esc(f.historical_ed_minutes)} min</strong> CMS historical ED median</span>`;
        }

        return `
          <article class="hospital-card" id="card-${i}" data-index="${i}">
            <div class="card-top-row">
              <span class="rank-badge">${i + 1}</span>
              ${kindBadge}
            </div>

            <h3>${esc(f.name)}</h3>
            <p class="facility-address">
              <span class="material-symbols-outlined icon-inline" style="font-size:14px;color:#80868b">place</span>
              ${esc(f.address || 'Address details in live map record')}
            </p>

            <div class="travel-stat-box">
              <div class="travel-time-row">
                <div class="travel-minutes-group">
                  <span class="travel-minutes-number">${travelMins}</span>
                  <span class="travel-mode-desc">min ${esc((f.travel?.label || 'drive').toLowerCase())}</span>
                </div>
                <span class="travel-road-dist">${f.road_miles || '—'} mi by road</span>
              </div>
              <div class="google-progress-bar">
                <div class="google-progress-fill" style="width: ${bar}%"></div>
              </div>
            </div>

            ${scoreHtml}

            <div class="facility-metrics">
              <span class="metric-chip"><strong>${f.straight_miles || '—'} mi</strong> straight-line</span>
              <span class="metric-chip unreported">Available beds: unverified</span>
              <span class="metric-chip unreported">${admission}</span>
              ${edMetric}
            </div>

            <a class="card-detail-btn" href="${link(f)}">
              <span>View Official CMS &amp; NPPES Registry Records</span>
              <span class="material-symbols-outlined" style="font-size:16px">arrow_forward</span>
            </a>
          </article>
        `;
      })
      .join('');
  }

  const miles = (a, b) => {
    const r = (n) => (n * Math.PI) / 180;
    const dl = r(b.lat - a.lat);
    const dn = r(b.lon - a.lon);
    const h =
      Math.sin(dl / 2) ** 2 +
      Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dn / 2) ** 2;
    return 7917.6 * Math.asin(Math.sqrt(h));
  };

  function renderNetwork(items, canvasId, detailId) {
    const svg = document.querySelector(canvasId);
    const detail = document.querySelector(detailId);
    if (!svg || !detail) return;

    svg.replaceChildren();

    const nodes = items
      .filter((f) => Number.isFinite(+f.lat) && Number.isFinite(+f.lon))
      .map((f, idx) => ({ ...f, lat: +f.lat, lon: +f.lon, originalIndex: idx }));

    if (!nodes.length) {
      detail.innerHTML =
        '<span class="material-symbols-outlined">warning</span> Distance network topology unavailable (coordinates omitted in source response).';
      return;
    }

    const ns = 'http://www.w3.org/2000/svg';
    const make = (tag, a = {}) => {
      const e = document.createElementNS(ns, tag);
      Object.entries(a).forEach(([k, v]) => e.setAttribute(k, v));
      return e;
    };

    const w = 1000;
    const h = 420;
    const m = 60;

    const lats = nodes.map((n) => n.lat);
    const lons = nodes.map((n) => n.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    nodes.forEach((n) => {
      n.x = m + ((n.lon - minLon) / (maxLon - minLon || 1)) * (w - m * 2);
      n.y = m + ((maxLat - n.lat) / (maxLat - minLat || 1)) * (h - m * 2);
    });

    const edges = [];
    const seen = new Set();
    let totalDist = 0;

    nodes.forEach((node, i) => {
      const nearest = nodes
        .map((other, j) => ({ j, d: miles(node, other) }))
        .filter((x) => x.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);

      nearest.forEach((x) => {
        const key = [i, x.j].sort((a, b) => a - b).join('-');
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ a: node, b: nodes[x.j], d: x.d });
          totalDist += x.d;
        }
      });
    });

    // Update Live Graph KPI Stats Bar if present
    const statNodes = document.querySelector('#stat-nodes');
    const statEdges = document.querySelector('#stat-edges');
    const statDensity = document.querySelector('#stat-density');
    const statFastest = document.querySelector('#stat-fastest');

    if (statNodes) statNodes.textContent = nodes.length;
    if (statEdges) statEdges.textContent = edges.length;
    if (statDensity) {
      statDensity.textContent = edges.length
        ? `${(totalDist / edges.length).toFixed(1)} mi`
        : '0 mi';
    }
    if (statFastest && nodes.length > 0) {
      const fastestMins = Math.min(...nodes.map((n) => n.travel?.minutes || 999));
      statFastest.textContent = fastestMins < 999 ? `${fastestMins} min` : '--';
    }

    const show = (html) => {
      detail.innerHTML = html;
    };

    // Draw Vector Lines (Edges)
    edges.forEach((e) => {
      const line = make('line', {
        x1: e.a.x,
        y1: e.a.y,
        x2: e.b.x,
        y2: e.b.y,
        class: 'network-edge',
        tabindex: '0',
        role: 'img',
        'aria-label': `${e.a.name} to ${e.b.name}, ${e.d.toFixed(1)} miles`,
      });

      const title = make('title');
      title.textContent = `${e.a.name} ↔ ${e.b.name}: ${e.d.toFixed(1)} straight-line miles`;
      line.append(title);

      const view = () => {
        line.classList.add('active');
        show(
          `<span class="material-symbols-outlined">hub</span> Proximity Vector: <strong>${esc(
            e.a.name
          )}</strong> &harr; <strong>${esc(e.b.name)}</strong> &bull; ${e.d.toFixed(
            1
          )} straight-line miles apart.`
        );
      };

      const unview = () => {
        line.classList.remove('active');
      };

      line.addEventListener('mouseenter', view);
      line.addEventListener('focus', view);
      line.addEventListener('mouseleave', unview);
      line.addEventListener('blur', unview);
      svg.append(line);
    });

    // Draw Healthcare Facility Nodes
    nodes.forEach((n) => {
      const isUrgent = n.kind === 'urgent_care';
      const kindLabel = isUrgent ? 'Urgent Care' : 'Hospital';
      const colorClass = isUrgent ? 'urgent-care' : 'hospital';

      const g = make('g', { class: 'node-group' });

      // Pulse ring for top ranked facility
      if (n.originalIndex === 0) {
        const pulse = make('circle', {
          cx: n.x,
          cy: n.y,
          r: '15',
          fill: 'none',
          stroke: '#1a73e8',
          'stroke-width': '2',
          opacity: '0.4',
        });
        g.append(pulse);
      }

      const circle = make('circle', {
        cx: n.x,
        cy: n.y,
        r: n.originalIndex === 0 ? '11' : '9',
        class: `network-node ${colorClass}`,
        tabindex: '0',
        role: 'button',
        'aria-label': `${kindLabel}: ${n.name}`,
      });

      const title = make('title');
      title.textContent = `${kindLabel}: ${n.name} (${n.travel?.minutes || '?'} min)`;
      circle.append(title);

      const view = () => {
        circle.classList.add('active');
        show(
          `<span class="material-symbols-outlined" style="color:${
            isUrgent ? '#1e8e3e' : '#1a73e8'
          }">local_hospital</span> <strong>${esc(
            n.name
          )}</strong> (${kindLabel}) &bull; ${
            n.travel?.minutes !== undefined ? `${n.travel.minutes} min` : 'No ETA'
          } transit &bull; ${
            n.road_miles !== undefined ? `${n.road_miles} mi by road` : ''
          }. Click node to view card.`
        );
      };

      const unview = () => {
        circle.classList.remove('active');
      };

      const select = () => {
        const targetCard = document.querySelector(`#card-${n.originalIndex}`);
        if (targetCard) {
          document.querySelectorAll('.hospital-card').forEach((c) =>
            c.classList.remove('highlighted')
          );
          targetCard.classList.add('highlighted');
          targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      };

      circle.addEventListener('mouseenter', view);
      circle.addEventListener('focus', view);
      circle.addEventListener('mouseleave', unview);
      circle.addEventListener('blur', unview);
      circle.addEventListener('click', select);

      g.append(circle);
      svg.append(g);
    });

    detail.innerHTML = `
      <span class="material-symbols-outlined" style="color:#1a73e8">check_circle</span>
      <strong>${nodes.length} healthcare facilities</strong> mapped with <strong>${edges.length} proximity vectors</strong>. Hover or tap nodes to inspect.
    `;
  }

  function setupForm(formId, url, panel, target, label, care) {
    const form = document.querySelector(formId);
    if (!form) return;

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const b = form.querySelector('button[type=submit]');
      const zip = form.querySelector('input[inputmode=numeric]').value.trim();
      const mode = form.querySelector('input[name=mode]:checked')?.value || 'drive';
      const radius = form.querySelector('input[name=radius]')?.value || 15;
      const concerns = [
        ...form.querySelectorAll('input[name=concern]:checked'),
      ].map((x) => x.value);

      setButton(b, true, label);

      try {
        const d = await post(url, { zip, mode, radius, concerns });
        const list = d.facilities || [];

        if (care) {
          const a = d.assessment;
          const assessmentEl = document.querySelector('#assessment');
          if (assessmentEl) {
            assessmentEl.innerHTML = `
              <article class="assessment-card ${esc(a.level)}">
                <span class="badge-eyebrow">${esc(a.action)}</span>
                <h2>${esc(a.title)}</h2>
                <p>${esc(a.message)}</p>
              </article>
            `;
          }
        }

        const targetEl = document.querySelector(target);
        if (targetEl) targetEl.innerHTML = cards(list);

        renderNetwork(
          list,
          care ? '#care-network-canvas' : '#network-canvas',
          care ? '#care-network-detail' : '#network-detail'
        );

        const contextEl = document.querySelector(
          care ? '#care-context' : '#result-context'
        );
        if (contextEl && list.length > 0) {
          contextEl.textContent = `${care ? `${d.care_filter}. ` : ''}Origin: ${
            d.location.label
          }. Found ${list.length} facilities within ${
            d.radius_miles
          } miles, ranked by ${list[0].travel.label.toLowerCase()} travel duration.`;
        }

        const p = document.querySelector(panel);
        if (p) {
          p.hidden = false;
          p.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch (x) {
        alert(x.message);
      } finally {
        setButton(b, false, label);
      }
    });
  }

  // Initialize Core Search Forms
  setupForm(
    '#route-form',
    '/api/discover',
    '#result-panel',
    '#results',
    'Discover Facilities',
    false
  );
  setupForm(
    '#care-form',
    '/api/care-guide',
    '#care-results',
    '#care-hospitals',
    'Generate Care Guidance',
    true
  );

  // Radius Sliders
  document.querySelectorAll('input[name=radius]').forEach((s) => {
    const label = document.querySelector(`#${s.id}-label`);
    const update = () => {
      if (label) label.textContent = `${s.value} miles`;
    };
    s.addEventListener('input', update);
    update();
  });

  // Sample Location Chips
  document.querySelectorAll('.sample-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const sampleZip = chip.dataset.zip;
      const zipInput = document.querySelector('#zip') || document.querySelector('#care-zip');
      if (zipInput) {
        zipInput.value = sampleZip;
        zipInput.focus();
        const form = zipInput.closest('form');
        if (form) {
          const submitBtn = form.querySelector('button[type=submit]');
          if (submitBtn) submitBtn.click();
        }
      }
    });
  });

  // Recommender Form
  const rf = document.querySelector('#recommend-form');
  if (rf) {
    rf.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const b = rf.querySelector('button[type=submit]');
      const zip = document.querySelector('#recommend-zip').value.trim();
      const mode = rf.querySelector('input[name=mode]:checked')?.value || 'drive';

      setButton(b, true, 'Compute Comparison');

      try {
        const d = await post('/api/recommend', { zip, mode });
        const mathEl = document.querySelector('#recommend-math');
        if (mathEl) mathEl.textContent = d.math;

        const contextEl = document.querySelector('#recommend-context');
        if (contextEl) {
          contextEl.textContent = `Origin: ${d.location.label}. Sorted by composite access efficiency. Facilities missing certified CMS throughput records remain listed as unranked referrals.`;
        }

        const hospitalsEl = document.querySelector('#recommend-hospitals');
        if (hospitalsEl) {
          hospitalsEl.innerHTML = cards(d.hospitals, true);
        }

        const p = document.querySelector('#recommend-results');
        if (p) {
          p.hidden = false;
          p.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch (x) {
        alert(x.message);
      } finally {
        setButton(b, false, 'Compute Comparison');
      }
    });
  }

  // Facility Detail Page Handler
  if (window.facilityQuery) {
    post('/api/facility-detail', window.facilityQuery)
      .then((d) => {
        const rawRating = d.cms && d.cms.hospital_overall_rating;
        const rating = /^[1-5]$/.test(String(rawRating || ''))
          ? `<span class="rating-stars">${'★'.repeat(Number(rawRating))}${'☆'.repeat(
              5 - Number(rawRating)
            )}</span> (${esc(rawRating)} / 5 stars)`
          : 'Rating Not Available';

        const cms = d.cms
          ? `
            <div class="detail-card-panel">
              <h2><span class="material-symbols-outlined">verified</span> CMS Care Compare</h2>
              <p>
                <strong>${esc(d.cms.facility_name)}</strong><br>
                <strong>Type:</strong> ${esc(d.cms.hospital_type || 'General Hospital')}<br>
                <strong>Emergency Services:</strong> ${esc(d.cms.emergency_services || 'Yes')}<br>
                <strong>CMS Quality Rating:</strong> ${rating}<br>
                <strong>Facility Phone:</strong> ${esc(d.cms.telephone_number || 'Not listed')}<br>
                <strong>Birthing Friendly:</strong> ${esc(d.cms.meets_criteria_for_birthing_friendly_designation || 'No information')}
              </p>
            </div>`
          : `
            <div class="detail-card-panel">
              <h2><span class="material-symbols-outlined">info</span> CMS Care Compare</h2>
              <p>No certified Medicare hospital record was matched for this map entry.</p>
            </div>`;

        const n = d.nppes
          ? `
            <div class="detail-card-panel">
              <h2><span class="material-symbols-outlined">badge</span> CMS NPPES Registry</h2>
              <p>
                <strong>NPI:</strong> <span class="chip chip-blue" style="padding:2px 8px;font-family:monospace">${esc(d.nppes.npi)}</span><br>
                <strong>Organization:</strong> ${esc(d.nppes.organization)}<br>
                <strong>Registered Address:</strong> ${esc(d.nppes.address || 'Not listed')}<br>
                <strong>Phone:</strong> ${esc(d.nppes.phone || 'Not listed')}<br>
                <strong>Last Updated:</strong> ${esc(d.nppes.last_updated || 'Not listed')}<br>
                <strong>Taxonomy:</strong> ${esc(d.nppes.taxonomies?.join(', ') || 'General Healthcare')}
              </p>
            </div>`
          : `
            <div class="detail-card-panel">
              <h2><span class="material-symbols-outlined">badge</span> CMS NPPES Registry</h2>
              <p>No verified NPPES registration found for this specific search string.</p>
            </div>`;

        const ed = d.ed_throughput
          ? `
            <div class="detail-card-panel">
              <h2><span class="material-symbols-outlined">timer</span> Historical CMS ED Throughput</h2>
              <p>
                <strong style="font-size:1.3rem;color:#1a73e8">${esc(d.ed_throughput.score)} minutes</strong><br>
                <span>${esc(d.ed_throughput.measure_name || 'Emergency Department Throughput')}</span><br>
                <strong>Reporting Period:</strong> ${esc(d.ed_throughput.start_date)} to ${esc(d.ed_throughput.end_date)}<br>
                <span class="helper-text" style="margin-top:6px">Historical federal certified metric — not live queue wait time.</span>
              </p>
            </div>`
          : `
            <div class="detail-card-panel">
              <h2><span class="material-symbols-outlined">timer</span> Historical CMS ED Throughput</h2>
              <p>No OP-18b measure reported in CMS provider datastore.</p>
            </div>`;

        const ops = `
          <div class="detail-card-panel">
            <h2><span class="material-symbols-outlined">monitoring</span> Live Capacity &amp; Admission</h2>
            <p>
              <strong>Available Bed Census:</strong> Not reported by public APIs<br>
              <strong>Live ER Intake Wait:</strong> Not publicly broadcast<br>
              <strong>Direct Admission Chance:</strong> Requires hospital operational EHR feed<br>
              <span class="helper-text" style="margin-top:6px">Always call 911 in life-threatening scenarios.</span>
            </p>
          </div>`;

        const detailEl = document.querySelector('#facility-detail');
        if (detailEl) {
          detailEl.innerHTML = `<div class="detail-grid">${cms}${n}${ed}${ops}</div>`;
        }
      })
      .catch((x) => {
        const detailEl = document.querySelector('#facility-detail');
        if (detailEl) {
          detailEl.innerHTML = `<p class="hero-lede" style="color:#d93025">${esc(x.message)}</p>`;
        }
      });
  }
})();
