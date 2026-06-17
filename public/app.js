// State Management
let domainsList = [];
let domainsData = {}; // Stores status check results key by domain
let autoRefreshInterval = null;
const AUTO_REFRESH_TIME_MS = 30000; // 30 seconds

// DOM Elements
const monitorsContainer = document.getElementById('monitors-container');
const addDomainForm = document.getElementById('add-domain-form');
const domainInput = document.getElementById('domain-input');
const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
const refreshAllBtn = document.getElementById('refresh-all-btn');
const scanBtn = document.getElementById('scan-btn');
const toastContainer = document.getElementById('toast-container');

// Stats Elements
const statTotal = document.getElementById('stat-total');
const statOnline = document.getElementById('stat-online');
const statLatency = document.getElementById('stat-latency');
const statUpdated = document.getElementById('stat-updated');
const monitorsCount = document.getElementById('monitors-count');

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
});

async function initApp() {
    showInitialLoader();
    await fetchDomains();
    if (domainsList.length > 0) {
        buildSkeletonCards();
        checkAllDomains();
    } else {
        monitorsContainer.innerHTML = `
            <div class="initial-loader">
                <i data-lucide="alert-triangle" style="width: 40px; height: 40px; color: var(--color-degraded); margin-bottom: 16px;"></i>
                <p>No domains monitored yet. Add one above or scan DNS!</p>
            </div>
        `;
        updateStats();
        lucide.createIcons();
    }
    setupAutoRefresh();
}

function setupEventListeners() {
    // Add Domain Form
    addDomainForm.addEventListener('submit', handleAddDomain);

    // Refresh All Button
    refreshAllBtn.addEventListener('click', () => {
        showToast('Refreshing all monitors...', 'info');
        checkAllDomains();
    });

    // Scan Button
    scanBtn.addEventListener('click', handleScanSubdomains);

    // Auto Refresh Toggle
    autoRefreshToggle.addEventListener('change', setupAutoRefresh);
}

// Fetch list of monitored domains
async function fetchDomains() {
    const localData = localStorage.getItem('xlnt_mntr_domains');
    if (localData) {
        try {
            domainsList = JSON.parse(localData);
            return;
        } catch (e) {
            console.error('Failed to parse localStorage domains:', e);
        }
    }

    // Fallback to fetch default domains from server
    try {
        const response = await fetch('/api/domains');
        if (!response.ok) throw new Error('Failed to fetch domains');
        domainsList = await response.json();
        localStorage.setItem('xlnt_mntr_domains', JSON.stringify(domainsList));
    } catch (error) {
        console.error(error);
        showToast('Failed to load default domains from server', 'error');
        // Final fallback if offline
        domainsList = [
            { domain: 'xlnt.my.id', name: 'Main Site', type: 'root' },
            { domain: 'eldorian.xlnt.my.id', name: 'Eldorian Subdomain', type: 'subdomain' }
        ];
        localStorage.setItem('xlnt_mntr_domains', JSON.stringify(domainsList));
    }
}

// Build empty/skeleton card shells for immediate visual feedback
function buildSkeletonCards() {
    monitorsContainer.innerHTML = '';
    domainsList.forEach(item => {
        const card = createSkeletonCardHTML(item);
        monitorsContainer.appendChild(card);
    });
    updateStats();
    lucide.createIcons();
}

function createSkeletonCardHTML(item) {
    const card = document.createElement('div');
    card.className = `monitor-card loading`;
    card.id = `card-${item.domain.replace(/\./g, '_')}`;
    card.innerHTML = `
        <div class="card-header-main">
            <div class="card-title-block">
                <div class="status-indicator"></div>
                <div class="domain-name-wrap">
                    <span class="domain-label">${item.name}</span>
                    <span class="domain-url-sub">${item.domain}</span>
                </div>
            </div>
            <div class="card-quick-stats">
                <div class="quick-stat">
                    <span class="quick-stat-label">Latency</span>
                    <span class="quick-stat-val">-</span>
                </div>
                <div class="quick-stat">
                    <span class="quick-stat-label">HTTP</span>
                    <span class="quick-stat-val">-</span>
                </div>
                <div class="card-actions">
                    <a href="https://${item.domain}" target="_blank" class="visit-link">
                        <span>Visit</span>
                        <i data-lucide="external-link" style="width: 12px; height: 12px;"></i>
                    </a>
                    <button class="btn-card refresh-single-btn" title="Refresh monitor">
                        <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i>
                    </button>
                    ${item.type !== 'root' ? `
                        <button class="btn-card delete btn-card-delete" title="Delete monitor">
                            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    // Hook events inside the skeleton immediately
    card.querySelector('.refresh-single-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        checkSingleDomain(item.domain);
    });
    
    const delBtn = card.querySelector('.btn-card-delete');
    if (delBtn) {
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleDeleteDomain(item.domain);
        });
    }

    return card;
}

// Check single domain and update its UI card
async function checkSingleDomain(domain) {
    const safeId = domain.replace(/\./g, '_');
    const card = document.getElementById(`card-${safeId}`);
    if (card) {
        card.classList.add('loading');
        const indicator = card.querySelector('.status-indicator');
        if (indicator) indicator.style.animation = 'pulse 1.5s infinite';
    }

    try {
        const response = await fetch(`/api/status/${domain}`);
        if (!response.ok) throw new Error('Network error');
        const data = await response.json();
        
        domainsData[domain] = data;
        updateCardUI(domain, data);
    } catch (error) {
        console.error(error);
        const fallbackData = {
            domain,
            status: 'offline',
            error: 'Failed to query monitoring server'
        };
        domainsData[domain] = fallbackData;
        updateCardUI(domain, fallbackData);
    } finally {
        if (card) {
            card.classList.remove('loading');
            const indicator = card.querySelector('.status-indicator');
            if (indicator) indicator.style.animation = '';
        }
        updateStats();
    }
}

// Check all domains in parallel
function checkAllDomains() {
    domainsList.forEach(item => {
        checkSingleDomain(item.domain);
    });
}

// Update card contents with fetched status info
function updateCardUI(domain, data) {
    const safeId = domain.replace(/\./g, '_');
    const card = document.getElementById(`card-${safeId}`);
    if (!card) return;

    // Remove old classes and add new status class
    card.className = `monitor-card ${data.status}`;
    
    // Check if details were expanded before refresh
    const detailsElement = card.querySelector('.card-details');
    const isExpanded = detailsElement ? !detailsElement.classList.contains('collapsed') : false;

    // Get current domain info from the list
    const domainInfo = domainsList.find(d => d.domain === domain) || {};
    const displayName = domainInfo.name || data.name || domain.split('.')[0];

    // Build the main header row
    const isOnline = data.status === 'online';
    const latencyVal = isOnline && data.timings && data.timings.total ? `${data.timings.total} ms` : '—';
    const statusCodeVal = isOnline ? data.statusCode : (data.error ? 'ERR' : 'Offline');
    
    let latencyClass = '';
    if (isOnline && data.timings && data.timings.total) {
        const t = data.timings.total;
        if (t < 200) latencyClass = 'latency-good';
        else if (t < 600) latencyClass = 'latency-warn';
        else latencyClass = 'latency-bad';
    }

    card.innerHTML = `
        <div class="card-header-main">
            <div class="card-title-block">
                <div class="status-indicator"></div>
                <div class="domain-name-wrap">
                    <span class="domain-label">${displayName}</span>
                    <span class="domain-url-sub">${domain}</span>
                </div>
            </div>
            
            <div class="card-quick-stats">
                <div class="quick-stat">
                    <span class="quick-stat-label">Latency</span>
                    <span class="quick-stat-val ${latencyClass}">${latencyVal}</span>
                </div>
                <div class="quick-stat">
                    <span class="quick-stat-label">HTTP</span>
                    <span class="quick-stat-val ${isOnline ? 'text-success' : 'text-danger'}">${statusCodeVal}</span>
                </div>
                <div class="card-actions">
                    <a href="https://${domain}" target="_blank" class="visit-link">
                        <span>Visit</span>
                        <i data-lucide="external-link" style="width: 12px; height: 12px;"></i>
                    </a>
                    <button class="btn-card refresh-single-btn" title="Refresh monitor">
                        <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i>
                    </button>
                    ${domainInfo.type !== 'root' ? `
                        <button class="btn-card delete btn-card-delete" title="Delete monitor">
                            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                        </button>
                    ` : ''}
                    
                    <button class="expand-toggle ${isExpanded ? 'active' : ''}" title="Toggle technical details">
                        <span>More.</span>
                        <i data-lucide="chevron-down" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
            </div>
        </div>

        <!-- Details Box -->
        <div class="card-details ${isExpanded ? '' : 'collapsed'}">
            ${isOnline ? renderOnlineDetailsHTML(data) : renderOfflineDetailsHTML(data)}
        </div>
    `;

    // Rebind event listeners
    card.querySelector('.refresh-single-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        checkSingleDomain(domain);
    });
    
    const delBtn = card.querySelector('.btn-card-delete');
    if (delBtn) {
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleDeleteDomain(domain);
        });
    }

    const toggleBtn = card.querySelector('.expand-toggle');
    const detailsBox = card.querySelector('.card-details');
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleBtn.classList.toggle('active');
        detailsBox.classList.toggle('collapsed');
    });

    // Handle nested copy buttons inside details
    card.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const textToCopy = btn.getAttribute('data-copy');
            copyToClipboard(textToCopy);
        });
    });

    // Populate timing bar widths
    if (isOnline && data.timings) {
        setTimeout(() => {
            const t = data.timings;
            const max = t.total || 1;
            
            const setWidth = (classSuffix, val) => {
                const bar = card.querySelector(`.timing-bar-${classSuffix}`);
                if (bar && val) {
                    const pct = Math.max(2, Math.min(100, (val / max) * 100));
                    bar.style.width = `${pct}%`;
                }
            };

            setWidth('dns', t.dns);
            setWidth('tcp', t.tcp);
            setWidth('tls', t.tls);
            setWidth('ttfb', t.ttfb);
            setWidth('total', t.total);
        }, 50);
    }

    lucide.createIcons();
}

// HTML Renderer for online domains
function renderOnlineDetailsHTML(data) {
    const t = data.timings || {};
    
    // SSL Expiry calculation and badge
    let sslHTML = `
        <div class="ssl-card">
            <div class="ssl-header">
                <span class="detail-section-title" style="margin-bottom:0;"><i data-lucide="shield-check"></i> SSL Certificate</span>
                <span class="ssl-status-badge warning">No Certificate Details</span>
            </div>
            <div class="ssl-detail">Failed to fetch SSL/TLS metadata or connection was insecure.</div>
        </div>
    `;

    if (data.ssl) {
        const ssl = data.ssl;
        const isExpiringSoon = ssl.daysRemaining < 14;
        const badgeClass = isExpiringSoon ? 'warning' : 'secure';
        const badgeText = isExpiringSoon ? 'Expiring Soon' : 'Secure';
        
        sslHTML = `
            <div class="ssl-card">
                <div class="ssl-header">
                    <span class="detail-section-title" style="margin-bottom:0;"><i data-lucide="shield-check"></i> SSL Certificate</span>
                    <span class="ssl-status-badge ${badgeClass}">${badgeText}</span>
                </div>
                <div class="ssl-detail">
                    <div><strong>Issuer:</strong> ${ssl.issuer}</div>
                    <div><strong>Expires:</strong> <span class="ssl-expiry">${new Date(ssl.validTo).toLocaleDateString()}</span> (<span class="${isExpiringSoon ? 'text-danger' : 'text-success'}">${ssl.daysRemaining} days remaining</span>)</div>
                </div>
            </div>
        `;
    }

    // DNS Records list formatting
    let dnsHTML = '';
    const dns = data.dns || {};
    const hasDNS = (dns.A && dns.A.length) || (dns.AAAA && dns.AAAA.length) || dns.CNAME || (dns.MX && dns.MX.length) || (dns.TXT && dns.TXT.length);

    if (hasDNS) {
        const renderDnsRows = (type, values) => {
            if (!values || values.length === 0) return '';
            const valArray = Array.isArray(values) ? values : [values];
            return `
                <div class="dns-type-block">
                    <span class="dns-type-name">${type}</span>
                    <div class="dns-type-vals">
                        ${valArray.map(v => `
                            <div class="dns-val-item">
                                <span>${v}</span>
                                <button class="copy-btn" data-copy="${v}" title="Copy record value">
                                    <i data-lucide="copy" style="width: 10px; height: 10px;"></i>
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        };

        dnsHTML = `
            <div class="dns-records-list">
                ${renderDnsRows('A', dns.A)}
                ${renderDnsRows('AAAA', dns.AAAA)}
                ${renderDnsRows('CNAME', dns.CNAME)}
                ${renderDnsRows('MX', dns.MX)}
                ${renderDnsRows('TXT', dns.TXT)}
            </div>
        `;
    } else {
        dnsHTML = `<div class="no-dns">No public DNS records resolved.</div>`;
    }

    // Bytes to KB/MB converter
    const formatBytes = (bytes) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return `
        <!-- Left: Latency & Server Info -->
        <div class="details-column">
            <div>
                <span class="detail-section-title"><i data-lucide="bar-chart-3"></i> Latency Breakdown</span>
                <div class="timing-chart">
                    <div class="timing-bar-wrapper">
                        <span class="timing-label">DNS Lookup</span>
                        <div class="timing-bar-container">
                            <div class="timing-bar timing-bar-dns"></div>
                        </div>
                        <span class="timing-val">${t.dns !== null ? `${t.dns} ms` : '—'}</span>
                    </div>
                    <div class="timing-bar-wrapper">
                        <span class="timing-label">TCP Connect</span>
                        <div class="timing-bar-container">
                            <div class="timing-bar timing-bar-tcp"></div>
                        </div>
                        <span class="timing-val">${t.tcp !== null ? `${t.tcp} ms` : '—'}</span>
                    </div>
                    <div class="timing-bar-wrapper">
                        <span class="timing-label">TLS Handshake</span>
                        <div class="timing-bar-container">
                            <div class="timing-bar timing-bar-tls"></div>
                        </div>
                        <span class="timing-val">${t.tls !== null ? `${t.tls} ms` : '—'}</span>
                    </div>
                    <div class="timing-bar-wrapper">
                        <span class="timing-label">TTFB</span>
                        <div class="timing-bar-container">
                            <div class="timing-bar timing-bar-ttfb"></div>
                        </div>
                        <span class="timing-val">${t.ttfb !== null ? `${t.ttfb} ms` : '—'}</span>
                    </div>
                    <div class="timing-bar-wrapper" style="font-weight: 700;">
                        <span class="timing-label" style="color: var(--text-primary);">Total</span>
                        <div class="timing-bar-container">
                            <div class="timing-bar timing-bar-total" style="background: var(--accent) !important;"></div>
                        </div>
                        <span class="timing-val">${t.total !== null ? `${t.total} ms` : '—'}</span>
                    </div>
                </div>
            </div>

            <div class="tech-grid">
                <div class="tech-item">
                    <span class="tech-label">Resolved IP</span>
                    <span class="tech-val">
                        ${data.ip || '—'}
                        ${data.ip ? `
                            <button class="copy-btn" data-copy="${data.ip}" title="Copy IP">
                                <i data-lucide="copy" style="width: 10px; height: 10px;"></i>
                            </button>
                        ` : ''}
                    </span>
                </div>
                <div class="tech-item">
                    <span class="tech-label">Web Server</span>
                    <span class="tech-val">${data.server || '—'}</span>
                </div>
                <div class="tech-item">
                    <span class="tech-label">Content Size</span>
                    <span class="tech-val">${formatBytes(data.size)}</span>
                </div>
                <div class="tech-item">
                    <span class="tech-label">Content Type</span>
                    <span class="tech-val" title="${data.contentType}">${data.contentType ? data.contentType.split(';')[0] : '—'}</span>
                </div>
            </div>
        </div>

        <!-- Right: SSL & DNS Records -->
        <div class="details-column">
            ${sslHTML}
            
            <div>
                <span class="detail-section-title"><i data-lucide="server-crash"></i> DNS Records</span>
                ${dnsHTML}
            </div>
        </div>
    `;
}

// HTML Renderer for offline domains
function renderOfflineDetailsHTML(data) {
    return `
        <div class="details-column" style="grid-column: 1 / -1;">
            <div style="background: rgba(255, 51, 102, 0.05); border: 1px solid rgba(255, 51, 102, 0.15); border-radius: 10px; padding: 20px; display: flex; align-items: flex-start; gap: 16px;">
                <i data-lucide="alert-octagon" style="width: 24px; height: 24px; color: var(--color-offline); flex-shrink: 0; margin-top: 2px;"></i>
                <div>
                    <h4 style="font-weight: 700; color: var(--color-offline); margin-bottom: 6px;">Outage / Network Error Detected</h4>
                    <p style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.4;">
                        The monitor was unable to establish a connection to the host. This could be due to a server crash, firewalls blocking traffic, DNS misconfiguration, or network timeouts.
                    </p>
                    <div style="margin-top: 14px; font-family: var(--font-mono); font-size: 0.8rem; background: rgba(0,0,0,0.3); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.03); color: var(--text-primary); display: inline-block;">
                        <strong>Diagnostic Code:</strong> ${data.error || 'Unknown network error'}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Calculate and update top header metrics
function updateStats() {
    const total = domainsList.length;
    let onlineCount = 0;
    let totalLatency = 0;
    let latencyCount = 0;

    domainsList.forEach(item => {
        const data = domainsData[item.domain];
        if (data) {
            if (data.status === 'online') {
                onlineCount++;
                if (data.timings && data.timings.total) {
                    totalLatency += data.timings.total;
                    latencyCount++;
                }
            }
        }
    });

    statTotal.textContent = total;
    statOnline.textContent = onlineCount;
    monitorsCount.textContent = `${total} active`;

    if (latencyCount > 0) {
        statLatency.textContent = `${Math.round(totalLatency / latencyCount)} ms`;
    } else {
        statLatency.textContent = '—';
    }

    const now = new Date();
    statUpdated.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Setup Auto Refresh interval
function setupAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }

    if (autoRefreshToggle.checked) {
        autoRefreshInterval = setInterval(() => {
            showToast('Auto-refreshing status...', 'info');
            checkAllDomains();
        }, AUTO_REFRESH_TIME_MS);
    }
}

// Add Domain handler
async function handleAddDomain(e) {
    e.preventDefault();
    const domainVal = domainInput.value.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');
    
    if (!domainVal) return;

    // Validation
    if (!domainVal.endsWith('xlnt.my.id') && domainVal !== 'xlnt.my.id') {
        showToast('Only subdomains of xlnt.my.id are supported.', 'error');
        return;
    }

    if (domainsList.some(d => d.domain === domainVal)) {
        showToast('Domain is already monitored', 'error');
        return;
    }

    const newDomain = {
        domain: domainVal,
        name: domainVal === 'xlnt.my.id' ? 'Main Site' : domainVal.split('.')[0],
        type: domainVal === 'xlnt.my.id' ? 'root' : 'subdomain'
    };

    domainsList.push(newDomain);
    localStorage.setItem('xlnt_mntr_domains', JSON.stringify(domainsList));

    showToast(`Added ${newDomain.domain} to monitors`, 'success');
    domainInput.value = '';
    
    // Add to active state and render skeleton
    const card = createSkeletonCardHTML(newDomain);
    monitorsContainer.appendChild(card);
    updateStats();
    lucide.createIcons();

    // Run immediate check
    checkSingleDomain(newDomain.domain);
}

// Delete Domain handler
async function handleDeleteDomain(domain) {
    if (domain === 'xlnt.my.id') {
        showToast('Cannot delete root domain', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to stop monitoring ${domain}?`)) {
        return;
    }

    showToast(`Removed ${domain}`, 'success');
    
    // Remove from list and state
    domainsList = domainsList.filter(d => d.domain !== domain);
    localStorage.setItem('xlnt_mntr_domains', JSON.stringify(domainsList));
    delete domainsData[domain];
    
    // Remove card element
    const safeId = domain.replace(/\./g, '_');
    const card = document.getElementById(`card-${safeId}`);
    if (card) card.remove();
    
    updateStats();
}

// Scan Subdomains handler
async function handleScanSubdomains() {
    scanBtn.disabled = true;
    const oldHTML = scanBtn.innerHTML;
    scanBtn.innerHTML = `<div class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin-bottom: 0; display: inline-block;"></div> <span>Scanning...</span>`;
    showToast('Scanning DNS for active subdomains...', 'info');

    try {
        const response = await fetch('/api/scan', { method: 'POST' });
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || 'Scan failed');

        // Merge scanned subdomains
        let addedCount = 0;
        data.found.forEach(item => {
            if (!domainsList.some(d => d.domain === item.domain)) {
                domainsList.push(item);
                addedCount++;
            }
        });

        if (addedCount > 0) {
            localStorage.setItem('xlnt_mntr_domains', JSON.stringify(domainsList));
            showToast(`Scan complete. Found ${data.found.length} active domains. Added ${addedCount} new ones to monitor.`, 'success');
            buildSkeletonCards();
            checkAllDomains();
        } else {
            showToast(`Scan complete. Found ${data.found.length} active domains. No new domains added.`, 'success');
        }
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        scanBtn.disabled = false;
        scanBtn.innerHTML = oldHTML;
        lucide.createIcons();
    }
}

// Clipboard copy helper
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!', 'success');
    }).catch(err => {
        console.error('Copy failed', err);
        showToast('Failed to copy', 'error');
    });
}

// Loader UI toggle
function showInitialLoader() {
    monitorsContainer.innerHTML = `
        <div class="initial-loader">
            <div class="spinner"></div>
            <p>Loading monitors and establishing secure handshakes...</p>
        </div>
    `;
}

// Toast notification helper
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'error') iconName = 'alert-octagon';

    toast.innerHTML = `
        <span class="toast-icon"><i data-lucide="${iconName}" style="width: 16px; height: 16px;"></i></span>
        <span class="toast-message">${message}</span>
    `;

    toastContainer.appendChild(toast);
    lucide.createIcons();

    // Auto-remove toast after 4 seconds
    setTimeout(() => {
        toast.style.animation = 'none'; // reset animation
        toast.offsetHeight; // trigger reflow
        toast.style.animation = 'toast-in 0.4s cubic-bezier(0.25, 0.8, 0.25, 1) reverse forwards';
        
        setTimeout(() => {
            toast.remove();
        }, 400);
    }, 4000);
}
