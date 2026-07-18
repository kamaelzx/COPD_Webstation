/* ============================================================
   COPD 慢病管理平台 · 前端交互 (接入后端 API)
   - 自动登录拿 token，所有请求带 Authorization
   - 拉取 dashboard / tips / medications / pharmacist / notifications 并渲染
   - 用药设置保存、打卡切换调用接口
   - 保留底部 Tab 切换、弹窗、Toast
   ============================================================ */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

let TOKEN = localStorage.getItem('copd_token') || '';
let CURRENT_USER = null; // 登录后缓存的用户资料
let medsToday = [];
let openWrap = null; // 当前左滑展开的那条用药，保证同时只开一条

/* ---------- 安全转义 ---------- */
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 请求封装 ---------- */
async function api(path, { method = 'GET', body } = {}) {
  const opt = {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) }
  };
  if (body) opt.body = JSON.stringify(body);
  let res = await fetch(path, opt);
  if (res.status === 401) {
    TOKEN = '';
    CURRENT_USER = null;
    localStorage.removeItem('copd_token');
    showAuth('login');
    throw new Error('未登录或登录已过期');
  }
  return res.json();
}

/* ---------- 登录 / 注册 / 登出 ---------- */
async function doLogin(phone, password) {
  const r = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || '登录失败');
  TOKEN = d.token;
  localStorage.setItem('copd_token', TOKEN);
  CURRENT_USER = d.user;
  if (d.pointsAwarded) toast('每日登录，健康积分 +1');
  return d.user;
}

async function doRegister(phone, name, password) {
  const r = await fetch('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, name, password })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || '注册失败');
  TOKEN = d.token;
  localStorage.setItem('copd_token', TOKEN);
  CURRENT_USER = d.user;
  if (d.pointsAwarded) toast('每日登录，健康积分 +1');
  return d.user;
}

async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* 即使失败也清理本地 */ }
  TOKEN = '';
  localStorage.removeItem('copd_token');
  medsToday = [];
  openWrap = null;
  if (window.__reminderTimer) { clearInterval(window.__reminderTimer); window.__reminderTimer = null; }
  showAuth('login');
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------- 屏幕切换（底部 Tab 与站内 data-nav 共用） ---------- */
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${id}`));
  // 同步底部 Tab 高亮（仅 home/med/profile 命中；讲座/呼吸操无对应 Tab，则不点亮任何 Tab）
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.target === id));
  // 进入吸入指导聊天屏时触发后台预热，让 Dify App 提前转热，首条消息更快出字
  if (id === 'inhale-chat' && typeof window.__inhaleWarmUp === 'function') window.__inhaleWarmUp();
}

/* ---------- Tab 切换 ---------- */
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => showScreen(tab.dataset.target));
});

/* ---------- Tile 跳转 / Toast ---------- */
$$('[data-nav]').forEach(el => {
  el.addEventListener('click', () => showScreen(el.dataset.nav));
});
$$('[data-toast]').forEach(el => {
  el.addEventListener('click', () => toast(el.dataset.toast));
});
$$('[data-href]').forEach(el => {
  el.addEventListener('click', () => { location.href = el.dataset.href; });
});

/* ---------- 用药项完成态切换（前端乐观更新 + 回写接口） ---------- */
async function toggleMed(item) {
  const id = item.dataset.id;
  const done = item.classList.toggle('done');
  const check = $('.check', item);
  const time = $('.med-time', item);
  if (done) {
    check.className = 'check check-done';
    check.textContent = '✓';
    time.className = 'med-time done-time';
    time.textContent = time.textContent.replace('待用药', '已用药');
    if (!time.textContent.includes('✓')) time.textContent += ' ✓';
  } else {
    check.className = 'check check-todo';
    check.textContent = '';
    time.className = 'med-time todo-time';
    time.textContent = time.textContent.replace(' ✓', '').replace('已用药', '待用药');
  }
  const m = medsToday.find(x => String(x.id) === String(id));
  if (m) { m.taken = done; renderHomeReminder(); renderMissedCard(); }
  try {
    const res = await api(`/api/medications/${id}/take`, { method: 'POST', body: { taken: done } });
    if (done && res && res.pointsAwarded) {
      toast('🎉 完成今日用药，健康积分 +1');
      loadDashboard(); // 刷新「我的」页积分与「今日 +」提示
    }
  } catch (e) {
    toast('网络异常，打卡未保存');
  }
}

/* ---------- 渲染今日用药列表（左滑出现「删除」色块） ---------- */
function renderMeds(list) {
  const card = $('#medCard');
  const header = $('.rem-header-row', card);
  $$('#medCard > .med-item, #medCard > .med-item-wrap', card).forEach(n => n.remove());
  openWrap = null;
  list.forEach(m => {
    const wrap = document.createElement('div');
    wrap.className = 'med-item-wrap';
    wrap.dataset.id = m.id;
    wrap.innerHTML = `
      <div class="med-del-reveal" role="button" aria-label="删除用药"><span>删除</span></div>
      <div class="med-item${m.taken ? ' done' : ''}" data-toggle="" data-id="${m.id}">
        <span class="check ${m.taken ? 'check-done' : 'check-todo'}">${m.taken ? '✓' : ''}</span>
        <div class="med-body">
          <p class="med-name">${escapeHtml(m.name)}${m.dose ? ' ' + escapeHtml(m.dose) : ''}</p>
          <p class="med-time ${m.taken ? 'done-time' : 'todo-time'}">${escapeHtml(m.time_slot)} ${m.taken ? '已用药 ✓' : '待用药'}</p>
        </div>
      </div>`;
    const item = $('.med-item', wrap);
    const delBtn = $('.med-del-reveal', wrap);
    card.insertBefore(wrap, header);
    attachSwipe(wrap, item, delBtn, m);
  });
}

/* 左滑手势：滑动卡片露出右侧「删除」色块，点击色块删除 */
function attachSwipe(wrap, item, delBtn, med) {
  const DEL_W = 72; // 删除色块宽度
  const EASE = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
  let startX = 0, startY = 0, dragging = false, decided = false, horiz = false, moved = false, startOpen = false;

  const isOpen = () => {
    const t = item.style.transform || '';
    const n = parseFloat(t.replace(/[^0-9.\-]/g, ''));
    return !isNaN(n) && n < -1;
  };
  const setX = (x, animate) => {
    item.style.transition = animate ? EASE : 'none';
    item.style.transform = `translateX(${x}px)`;
  };
  const closeOthers = () => {
    if (openWrap && openWrap !== wrap) {
      const it = $('.med-item', openWrap);
      if (it) setX(0, true);
    }
  };

  const onStart = (x, y) => {
    closeOthers();
    startX = x; startY = y; startOpen = isOpen();
    dragging = true; decided = false; horiz = false; moved = false;
    setX(startOpen ? -DEL_W : 0, false);
  };
  const onMove = (x, y, e) => {
    if (!dragging) return;
    const dx = x - startX, dy = y - startY;
    if (!decided) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      decided = true; horiz = Math.abs(dx) > Math.abs(dy);
    }
    if (!horiz) return;
    if (e && e.cancelable) e.preventDefault();
    moved = true;
    let nx = (startOpen ? -DEL_W : 0) + dx;
    setX(Math.max(-DEL_W, Math.min(0, nx)), false);
  };
  const onEnd = (x) => {
    if (!dragging) return;
    dragging = false;
    if (!horiz) return;
    const dx = x - startX;
    const final = (startOpen ? -DEL_W : 0) + dx;
    if (final < -DEL_W / 2) { setX(-DEL_W, true); openWrap = wrap; }
    else { setX(0, true); if (openWrap === wrap) openWrap = null; }
  };

  // 触摸
  item.addEventListener('touchstart', e => onStart(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  item.addEventListener('touchmove', e => onMove(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
  item.addEventListener('touchend', e => onEnd(e.changedTouches[0].clientX));
  // 鼠标：按下时挂载、松开即移除，避免 window 监听器随刷新累积
  const onMoveW = e => onMove(e.clientX, e.clientY, e);
  const onEndW = e => {
    onEnd(e.clientX);
    window.removeEventListener('mousemove', onMoveW);
    window.removeEventListener('mouseup', onEndW);
  };
  item.addEventListener('mousedown', e => {
    onStart(e.clientX, e.clientY);
    window.addEventListener('mousemove', onMoveW);
    window.addEventListener('mouseup', onEndW);
  });
  // 点击：展开态→收起；收起态→打卡切换；滑动后→吞掉误触
  item.addEventListener('click', e => {
    if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; return; }
    if (isOpen()) { setX(0, true); if (openWrap === wrap) openWrap = null; return; }
    toggleMed(item);
  });
  delBtn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`确定删除「${med.name}」吗？此操作不可撤销。`)) return;
    try {
      await api(`/api/medications/${med.id}`, { method: 'DELETE' });
      if (openWrap === wrap) openWrap = null;
      await loadMeds();
      toast('已删除该用药');
    } catch (err) {
      toast('删除失败，请重试');
    }
  });
}

/* ---------- 用药设置弹窗 ---------- */
const modal = $('#medModal');

/* 用药时间 · 时/分双滚轮滑动选择器 */
const TP_ITEM_H = 40;
const pad2 = n => String(n).padStart(2, '0');
const tpHourCol = $('#tpHour'), tpMinuteCol = $('#tpMinute');
const tpHourTrack = $('#tpHourTrack'), tpMinuteTrack = $('#tpMinuteTrack');
const medTimeInput = $('#medTime');
let curHour = 8, curMin = 0;
function buildWheel(track, count, step = 1){
  // 渲染 3 段：[后克隆][真实][前克隆]，实现首尾循环
  let h = '';
  for (let i = 0; i < count * 3; i++) {
    const v = (i % count) * step;
    h += `<div class="tp-item" data-val="${v}">${pad2(v)}</div>`;
  }
  track.innerHTML = h;
}
function highlightActive(track, realVal){
  [...track.children].forEach(c => c.classList.toggle('is-active', parseInt(c.dataset.val, 10) === realVal));
}
function centerWheel(col, nominalIdx){
  col.scrollTop = nominalIdx * TP_ITEM_H;
}
function syncMedTime(){ if (medTimeInput) medTimeInput.value = `${pad2(curHour)}:${pad2(curMin)}`; }
if (tpHourTrack && tpMinuteTrack) {
  const N_H = 24, N_M = 12;
  buildWheel(tpHourTrack, N_H, 1);
  buildWheel(tpMinuteTrack, N_M, 5);
  const onScroll = (col, track, N, step, set) => col.addEventListener('scroll', () => {
    const nominal = Math.round(col.scrollTop / TP_ITEM_H);
    const realIdx = ((nominal % N) + N) % N;   // 真实值索引（循环）
    const realVal = realIdx * step;
    highlightActive(track, realVal);
    set(realVal);
    // 滚入克隆区时静默跳回真实区（值相同，视觉无感）
    if (nominal < N || nominal >= 2 * N) {
      requestAnimationFrame(() => centerWheel(col, N + realIdx));
    }
  }, { passive: true });
  onScroll(tpHourCol, tpHourTrack, N_H, 1, v => { curHour = v; syncMedTime(); });
  onScroll(tpMinuteCol, tpMinuteTrack, N_M, 5, v => { curMin = v; syncMedTime(); });
  resetTimeWheel(8, 0);
  syncMedTime();
}
function resetTimeWheel(h = 8, m = 0){
  curHour = h; curMin = m;
  requestAnimationFrame(() => {
    centerWheel(tpHourCol, 24 + h);
    centerWheel(tpMinuteCol, 12 + Math.round(m / 5));
    highlightActive(tpHourTrack, h);
    highlightActive(tpMinuteTrack, Math.round(m / 5) * 5);
    syncMedTime();
  });
}
function openMedModal(){
  if (!modal) return;
  modal.removeAttribute('hidden');
  resetTimeWheel(8, 0);
}

if (modal) {
  $('#openMedSetup').addEventListener('click', openMedModal);
  $('#cancelMed').addEventListener('click', () => modal.setAttribute('hidden', ''));
  modal.addEventListener('click', e => { if (e.target === modal) modal.setAttribute('hidden', ''); });

  $('#saveMed').addEventListener('click', async () => {
    const name = $('#medName').value.trim();
    const dose = $('#medDose').value.trim();
    const time = $('#medTime').value;
    if (!name) { toast('请填写药品名称'); return; }
    if (!time) { toast('请选择用药时间'); return; }
    try {
      await api('/api/medications', { method: 'POST', body: { name, dose, time_slot: time } });
      $('#medName').value = ''; $('#medDose').value = ''; $('#medTime').value = '';
      modal.setAttribute('hidden', '');
      await loadMeds();
      toast('用药信息已保存');
    } catch (e) {
      toast('保存失败，请重试');
    }
  });
}

/* ---------- 药师排班详情弹窗 ---------- */
const pharmModal = $('#pharmModal');
if (pharmModal) {
  const closePharm = () => pharmModal.setAttribute('hidden', '');
  $$('.js-open-pharm').forEach(openEl => {
    openEl.addEventListener('click', () => pharmModal.removeAttribute('hidden'));
    openEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pharmModal.removeAttribute('hidden'); } });
  });
  $('#pharmClose').addEventListener('click', closePharm);
  $('#pharmOk').addEventListener('click', closePharm);
  pharmModal.addEventListener('click', e => { if (e.target === pharmModal) closePharm(); });
}

const quitModal = $('#quitModal');
if (quitModal) {
  const closeQuit = () => quitModal.setAttribute('hidden', '');
  $$('.js-open-quit').forEach(openEl => {
    openEl.addEventListener('click', () => quitModal.removeAttribute('hidden'));
    openEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); quitModal.removeAttribute('hidden'); } });
  });
  $('#quitClose').addEventListener('click', closeQuit);
  $('#quitOk').addEventListener('click', closeQuit);
  quitModal.addEventListener('click', e => { if (e.target === quitModal) closeQuit(); });
}

const helpModal = $('#helpModal');
if (helpModal) {
  const closeHelp = () => helpModal.setAttribute('hidden', '');
  $$('.js-open-help').forEach(openEl => {
    openEl.addEventListener('click', () => helpModal.removeAttribute('hidden'));
    openEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); helpModal.removeAttribute('hidden'); } });
  });
  $('#helpClose').addEventListener('click', closeHelp);
  $('#helpOk').addEventListener('click', closeHelp);
  helpModal.addEventListener('click', e => { if (e.target === helpModal) closeHelp(); });
}

const comingModal = $('#comingSoonModal');
if (comingModal) {
  const closeComing = () => comingModal.setAttribute('hidden', '');
  $$('.js-coming-soon').forEach(openEl => {
    openEl.addEventListener('click', () => {
      const feat = openEl.dataset.feature || '';
      $('#comingTitle').textContent = feat ? `${feat} · 功能开发中` : '功能开发中';
      $('#comingDesc').textContent = feat ? `${feat}功能正在开发，敬请期待` : '功能正在开发，敬请期待';
      comingModal.removeAttribute('hidden');
    });
    openEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEl.click(); } });
  });
  $('#comingOk').addEventListener('click', closeComing);
  comingModal.addEventListener('click', e => { if (e.target === comingModal) closeComing(); });
}

// 用药依从性重置（危险操作，二次确认）
const resetAdhModal = $('#resetAdherenceModal');
if (resetAdhModal) {
  const closeReset = () => resetAdhModal.setAttribute('hidden', '');
  const openReset = $('#openResetAdherence');
  if (openReset) {
    openReset.addEventListener('click', () => resetAdhModal.removeAttribute('hidden'));
    openReset.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); resetAdhModal.removeAttribute('hidden'); } });
  }
  $('#resetAdherenceClose').addEventListener('click', closeReset);
  $('#resetAdherenceCancelBtn').addEventListener('click', closeReset);
  resetAdhModal.addEventListener('click', e => { if (e.target === resetAdhModal) closeReset(); });
  $('#resetAdherenceConfirm').addEventListener('click', async () => {
    const btn = $('#resetAdherenceConfirm');
    btn.disabled = true;
    try {
      const r = await api('/medications/reset-adherence', { method: 'POST' });
      if (!r || !r.ok) throw new Error('reset failed');
      closeReset();
      toast('用药依从性已重置');
      loadDashboard();
      if (typeof loadMeds === 'function') loadMeds();
    } catch (err) {
      toast('重置失败，请重试');
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- 数据加载 ---------- */
async function loadDashboard() {
  const d = await api('/api/dashboard');
  const pn = $('.profile-name'); if (pn) pn.textContent = d.name;
  const ps = $('.profile-sub'); if (ps) ps.textContent = '管理第 ' + d.manageDays + ' 天';
  const mp = $('.metric-val.primary'); if (mp) mp.textContent = d.adherence + '%';
  const mids = $$('.metric-val');
  if (mids[1]) mids[1].textContent = (d.nextFollowUpDays === null || d.nextFollowUpDays === undefined) ? '未设置' : d.nextFollowUpDays + '天';
  const mint = $('.metric-val.mint'); if (mint) mint.textContent = d.points;
  const mt = $('#pointsToday'); if (mt) mt.textContent = (d.todayPoints > 0) ? ('今日 +' + d.todayPoints) : '';
}

async function loadTips() {
  const data = await api('/api/tips?all=1'); // 取全量，前端顺序轮循
  const tips = (data && data.tips) || [];
  if (!tips.length) return;
  let idx = parseInt(localStorage.getItem('copd_tip_idx') || '0', 10);
  if (!Number.isInteger(idx) || idx < 0 || idx >= tips.length) idx = 0;
  const t = tips[idx];
  const tag = $('.tip-card .tag'); if (tag) tag.textContent = t.category || '';
  const txt = $('.tip-text'); if (txt) txt.textContent = t.content || '';
  localStorage.setItem('copd_tip_idx', String((idx + 1) % tips.length)); // 推进指针，下次刷新显示下一条
}

async function loadMeds() {
  const d = await api('/api/medications/today');
  medsToday = d.meds || [];
  renderMeds(medsToday);
  renderHomeReminder();
  renderMissedCard();
}

/* ---------- 首页用药提醒（实时倒计时） ---------- */
function parseSlot(slot) {
  const [h, m] = (slot || '0:0').split(':').map(Number);
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 0, m || 0, 0, 0);
}

function nextUpcomingMed() {
  const now = new Date();
  return medsToday
    .filter(m => !m.taken && parseSlot(m.time_slot) > now)
    .sort((a, b) => parseSlot(a.time_slot) - parseSlot(b.time_slot))[0] || null;
}

function renderHomeReminder() {
  const card = document.getElementById('homeReminderCard');
  const timeEl = document.getElementById('reminderTime');
  const hintEl = document.getElementById('reminderHint');
  if (!timeEl || !hintEl) return;
  if (!medsToday.length) {
    if (card) {
      card.classList.add('is-empty');
      card.onclick = () => openMedModal();
    }
    timeEl.textContent = '今日暂无用药安排';
    hintEl.textContent = '点击此处添加用药 →';
    return;
  }
  if (card) { card.classList.remove('is-empty'); card.onclick = null; }
  const next = nextUpcomingMed();
  if (next) {
    timeEl.textContent = `今日 ${next.time_slot} · ${next.name}`;
    const diffMin = Math.floor((parseSlot(next.time_slot) - new Date()) / 60000);
    if (diffMin <= 0) hintEl.textContent = `⏰ ${next.time_slot} 用药时间已到，请尽快用药`;
    else {
      const h = Math.floor(diffMin / 60), mm = diffMin % 60;
      hintEl.textContent = `距离下次用药还有 ${h ? h + ' 小时 ' : ''}${mm} 分钟`;
    }
    return;
  }
  const unTaken = medsToday.filter(m => !m.taken);
  if (unTaken.length) {
    const first = unTaken.sort((a, b) => parseSlot(a.time_slot) - parseSlot(b.time_slot))[0];
    timeEl.textContent = `今日 ${first.time_slot} · ${first.name}`;
    hintEl.textContent = `⚠️ ${first.time_slot} 用药已过期，请尽快补用`;
  } else {
    timeEl.textContent = '今日用药已全部完成';
    hintEl.textContent = '🎉 继续保持，依从性棒棒的';
  }
}

/* ---------- 首页漏服药品提示卡（用药提醒上方） ---------- */
function renderMissedCard() {
  const card = document.getElementById('missedCard');
  if (!card) return;
  const titleEl = document.getElementById('missedTitle');
  const listEl = document.getElementById('missedList');
  const now = new Date();
  const missed = medsToday
    .filter(m => !m.taken && parseSlot(m.time_slot) < now)
    .sort((a, b) => parseSlot(a.time_slot) - parseSlot(b.time_slot));
  // 仅当确实存在漏服药品时才展示；无漏服（含有药但未到点 / 全部已服）一律隐藏
  if (!missed.length) {
    card.hidden = true;
    card.classList.remove('is-missed');
    card.onclick = null;
    card.style.cursor = 'default';
    return;
  }
  // 漏服：红色告警态，列出漏服药品
  card.hidden = false;
  card.classList.add('is-missed');
  titleEl.textContent = '漏用药品提醒';
  listEl.innerHTML = missed.map(m =>
    `<div class="missed-item"><span class="mi-name">${escapeHtml(m.name)}</span><span class="mi-time">${m.time_slot}</span></div>`
  ).join('');
  card.onclick = () => showScreen('med');
  card.style.cursor = 'pointer';
}

async function loadPharmacist() {
  const d = await api('/api/pharmacist/schedule');
  const info = $('.pharm-info');
  if (info && d.schedule && d.schedule.length) {
    const s = d.schedule[0];
    info.innerHTML = `${escapeHtml(s.dayOfWeek)} ${escapeHtml(s.session)} · ${escapeHtml(s.location)}<br>${escapeHtml(s.note)}`;
  }
}

async function loadNotifications() {
  const d = await api('/api/notifications');
  const list = d.notifications || [];
  const unread = list.filter(x => !x.isRead).length;
  renderNotifications(list, unread);
}

function fmtNotifTime(ts) {
  if (!ts) return '';
  try {
    const dt = new Date(ts.replace(' ', 'T'));
    const diff = (Date.now() - dt.getTime()) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
    return dt.toLocaleDateString('zh-CN');
  } catch (e) { return ''; }
}

function renderNotifications(list, unread) {
  const badge = $('#bellBadge');
  if (badge) {
    if (unread > 0) { badge.textContent = unread > 99 ? '99+' : String(unread); badge.hidden = false; }
    else { badge.hidden = true; }
  }
  const box = $('#notifList');
  if (!box) return;
  if (!list.length) {
    box.innerHTML = '<div class="notif-empty">暂无消息通知</div>';
    return;
  }
  box.innerHTML = list.map(n => `
    <div class="notif-item ${n.isRead ? 'read' : 'unread'}" data-id="${n.id}">
      <span class="notif-dot"></span>
      <div class="notif-main">
        <div class="notif-item-title">${escapeHtml(n.title)}</div>
        <div class="notif-item-body">${escapeHtml(n.body || '')}</div>
        <div class="notif-item-time">${fmtNotifTime(n.created_at)}</div>
      </div>
    </div>`).join('');
}

function bindNotificationsUI() {
  const bell = $('#bellBtn');
  const panel = $('#notifPanel');
  if (!bell || !panel) return;
  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== bell) {
      panel.hidden = true;
    }
  });
  $('#notifList').addEventListener('click', async (e) => {
    const item = e.target.closest('.notif-item');
    if (!item || item.classList.contains('read')) return;
    const id = Number(item.dataset.id);
    try {
      await api(`/api/notifications/${id}/read`, { method: 'POST' });
      await loadNotifications();
    } catch (err) { /* 忽略 */ }
  });
  $('#notifClear').addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('#notifList .notif-item:not(.read)')]
      .map(el => Number(el.dataset.id));
    try {
      await Promise.all(ids.map(id => api(`/api/notifications/${id}/read`, { method: 'POST' })));
      await loadNotifications();
      panel.hidden = true;
    } catch (err) { /* 忽略 */ }
  });
}

/* ---------- 登录屏 UI ---------- */
function setAuthMode(mode) {
  const loginForm = $('#loginForm'), regForm = $('#registerForm');
  if (mode === 'register') {
    loginForm.classList.add('hidden');
    regForm.classList.remove('hidden');
  } else {
    loginForm.classList.remove('hidden');
    regForm.classList.add('hidden');
  }
}
function showAuth(mode) {
  setAuthMode(mode || 'login');
  $('#authScreen').classList.remove('hidden');
}
function hideAuth() {
  $('#authScreen').classList.add('hidden');
}

function bindAuthUI() {
  $('#toRegister').addEventListener('click', () => setAuthMode('register'));
  $('#toLogin').addEventListener('click', () => setAuthMode('login'));

  // 密码显隐切换
  $$('.pw-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $('#' + btn.dataset.target);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('on', show);
      btn.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    });
  });

  $('#authLoginBtn').addEventListener('click', async () => {
    const phone = $('#authPhone').value.trim();
    const password = $('#authPassword').value;
    if (!/^\d{6,11}$/.test(phone)) { toast('请输入有效手机号'); return; }
    if (!password) { toast('请输入密码'); return; }
    try {
      const u = await doLogin(phone, password);
      hideAuth();
      if (u && u.name) toast('欢迎回来，' + u.name);
      await loadAll();
    } catch (e) { toast(e.message || '登录失败'); }
  });

  $('#authRegisterBtn').addEventListener('click', async () => {
    const phone = $('#regPhone').value.trim();
    const name = $('#regName').value.trim();
    const password = $('#regPassword').value;
    if (!/^\d{6,11}$/.test(phone)) { toast('请输入有效手机号'); return; }
    if (!name) { toast('请填写姓名'); return; }
    if (!password || password.length < 6) { toast('密码至少 6 位'); return; }
    try {
      const u = await doRegister(phone, name, password);
      hideAuth();
      toast('注册成功，' + (u && u.name || '欢迎使用'));
      await loadAll();
    } catch (e) { toast(e.message || '注册失败'); }
  });

  const logoutRow = $('#openLogout');
  const logoutModal = $('#logoutModal');
  const profileModalEl = $('#profileModal');
  if (logoutRow && logoutModal) {
    // 关闭退出确认弹窗（取消/点遮罩/✕）：回到「个人资料与设置」层
    const closeLogout = () => {
      logoutModal.setAttribute('hidden', '');
      if (profileModalEl) profileModalEl.removeAttribute('hidden');
    };
    // 打开确认弹窗前先收起「个人资料与设置」层，避免双层遮罩叠加
    logoutRow.addEventListener('click', () => {
      if (profileModalEl) profileModalEl.setAttribute('hidden', '');
      logoutModal.removeAttribute('hidden');
    });
    $('#logoutModalClose').addEventListener('click', closeLogout);
    $('#logoutModalCancel').addEventListener('click', closeLogout);
    logoutModal.addEventListener('click', e => { if (e.target === logoutModal) closeLogout(); });
    $('#logoutModalConfirm').addEventListener('click', () => {
      logoutModal.setAttribute('hidden', '');
      doLogout();
    });
  } else if (logoutRow) {
    logoutRow.addEventListener('click', () => doLogout());
  }

  bindProfileUI();
}

/* ---------- 个人资料与设置 / 编辑资料 / 修改密码（三者平级） ---------- */
function bindProfileUI() {
  const settingsModal = $('#profileModal');
  const editModal = $('#editProfileModal');
  const pwdModal = $('#passwordModal');
  if (!settingsModal || !editModal || !pwdModal) return;

  // 打开「个人资料与设置」设置列表
  $('#openProfile').addEventListener('click', () => {
    refreshFollowUpVal(); // 同步显示当前已设置的随访日期
    settingsModal.removeAttribute('hidden');
  });
  $('#profileClose').addEventListener('click', () => settingsModal.setAttribute('hidden', ''));
  settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.setAttribute('hidden', ''); });

  // 消息通知开关（即时存本地）
  const notify = $('#pfNotify');
  if (notify) {
    notify.checked = localStorage.getItem('copd_notify') !== 'off';
    notify.addEventListener('change', e => {
      localStorage.setItem('copd_notify', e.target.checked ? 'on' : 'off');
      toast(e.target.checked ? '已开启消息通知' : '已关闭消息通知');
    });
  }

  // 进入「编辑资料」独立页面
  $('#openEditProfile').addEventListener('click', async () => {
    settingsModal.setAttribute('hidden', '');
    try {
      const d = await api('/api/auth/me');
      CURRENT_USER = d.user;
      $('#pfName').value = d.user.name || '';
      $('#pfGender').value = d.user.gender || '男';
      $('#pfBirthday').value = d.user.birthday || '';
      $('#pfPhone').value = d.user.phone || '';
      $('#pfDiagnosis').value = d.user.diagnosis || '';
    } catch (e) {
      toast(e.message || '加载资料失败');
      settingsModal.removeAttribute('hidden');
      return;
    }
    editModal.removeAttribute('hidden');
  });
  const backToSettingsFromEdit = () => {
    editModal.setAttribute('hidden', '');
    settingsModal.removeAttribute('hidden');
  };
  $('#editProfileBack').addEventListener('click', backToSettingsFromEdit);
  $('#editProfileCancel').addEventListener('click', backToSettingsFromEdit);
  editModal.addEventListener('click', e => { if (e.target === editModal) backToSettingsFromEdit(); });

  $('#editProfileSave').addEventListener('click', async () => {
    const name = $('#pfName').value.trim();
    if (!name) { toast('姓名不能为空'); return; }
    try {
      const d = await api('/api/auth/me', {
        method: 'PUT',
        body: { name, gender: $('#pfGender').value, birthday: $('#pfBirthday').value, diagnosis: $('#pfDiagnosis').value.trim() }
      });
      CURRENT_USER = d.user;
      editModal.setAttribute('hidden', '');
      settingsModal.setAttribute('hidden', '');
      await loadDashboard(); // 同步刷新「我的」页姓名与首页问候
      toast('资料已保存');
    } catch (e) {
      toast(e.message || '资料保存失败');
    }
  });

  // 从设置列表进入「修改密码」独立页面
  $('#openChangePwd').addEventListener('click', () => {
    $('#pwdCur').value = ''; $('#pwdNew').value = ''; $('#pwdNew2').value = '';
    settingsModal.setAttribute('hidden', '');
    pwdModal.removeAttribute('hidden');
  });

  // 进入「下次随访时间」独立页面
  const followUpModal = $('#followUpModal');
  $('#openFollowUp').addEventListener('click', () => {
    settingsModal.setAttribute('hidden', '');
    const cur = (CURRENT_USER && CURRENT_USER.nextVisitDate) || '';
    $('#followUpDate').value = cur;
    updateFollowUpHint(cur);
    followUpModal.removeAttribute('hidden');
  });
  const backToSettingsFromFU = () => {
    followUpModal.setAttribute('hidden', '');
    settingsModal.removeAttribute('hidden');
    refreshFollowUpVal();
  };
  $('#followUpBack').addEventListener('click', backToSettingsFromFU);
  $('#followUpCancel').addEventListener('click', backToSettingsFromFU);
  followUpModal.addEventListener('click', e => { if (e.target === followUpModal) backToSettingsFromFU(); });
  $('#followUpDate').addEventListener('change', e => updateFollowUpHint(e.target.value));

  // 随访日期选择时实时预览倒计时
  function updateFollowUpHint(dateStr) {
    const hint = $('#followUpHint');
    if (!dateStr) { hint.textContent = '请选择下次随访日期，用于计算复诊倒计时'; return; }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr + 'T00:00:00');
    const days = Math.round((target - today) / 86400000);
    if (days > 0) hint.textContent = `距下次随访还有 ${days} 天（${dateStr}）`;
    else if (days === 0) hint.textContent = `随访日期为今天（${dateStr}）`;
    else hint.textContent = `⚠️ 该日期已过去 ${Math.abs(days)} 天，请确认`;
  }

  // 设置列表右侧显示当前随访日期
  function refreshFollowUpVal() {
    const v = (CURRENT_USER && CURRENT_USER.nextVisitDate) || '';
    const el = $('#followUpVal');
    if (el) el.textContent = v || '未设置';
  }

  $('#followUpSave').addEventListener('click', async () => {
    const date = $('#followUpDate').value.trim();
    try {
      const d = await api('/api/auth/me', { method: 'PUT', body: { nextVisitDate: date } });
      CURRENT_USER = d.user;
      followUpModal.setAttribute('hidden', '');
      settingsModal.setAttribute('hidden', '');
      await loadDashboard(); // 同步刷新「我的」页复诊倒计时
      toast('随访时间已保存');
    } catch (e) {
      toast(e.message || '保存失败');
    }
  });

  // 返回设置列表 / 取消
  const backToSettings = () => {
    pwdModal.setAttribute('hidden', '');
    settingsModal.removeAttribute('hidden');
  };
  $('#pwdBack').addEventListener('click', backToSettings);
  $('#pwdCancel').addEventListener('click', backToSettings);
  pwdModal.addEventListener('click', e => { if (e.target === pwdModal) backToSettings(); });

  // 保存新密码
  $('#pwdSave').addEventListener('click', async () => {
    const cur = $('#pwdCur').value;
    const nw = $('#pwdNew').value;
    const nw2 = $('#pwdNew2').value;
    if (!cur) { toast('请输入当前密码'); return; }
    if (nw.length < 6) { toast('新密码至少 6 位'); return; }
    if (nw !== nw2) { toast('两次输入的新密码不一致'); return; }
    try {
      await api('/api/auth/password', { method: 'PUT', body: { currentPassword: cur, newPassword: nw } });
      pwdModal.setAttribute('hidden', '');
      settingsModal.setAttribute('hidden', '');
      toast('密码修改成功');
    } catch (e) {
      toast(e.message || '密码修改失败');
    }
  });
}

/* ---------- 拉取全部首页数据 ---------- */
async function loadAll() {
  try {
    await Promise.all([loadDashboard(), loadTips(), loadMeds(), loadPharmacist(), loadNotifications()]);
  } catch (e) {
    console.error('数据加载失败', e);
  }
  if (!window.__reminderTimer) window.__reminderTimer = setInterval(renderHomeReminder, 30000);
}

/* ---------- 呼吸操屏（B 站三套课程，页内切换） ---------- */
const BREATH_COURSES = {
  breathing: {
    bvid: 'BV1Th4y1C7eQ', title: '呼吸操', up: '呼吸与急危重症医学', dur: '2:05',
    desc: '由呼吸与急危重症医学科示范的呼吸体操，将扩胸、侧腰拉伸、展臂等肢体动作与呼吸节奏同步，帮助打开胸腔、增强呼吸肌力量。',
    tips: [
      '动作与呼吸同频：扩胸 / 上举时吸气，收回 / 下压时呼气',
      '每日 1~2 次，每次 10~15 分钟，循序渐进',
      '饭后 1 小时内、空气不流通处不宜练习'
    ]
  },
  pursed: {
    bvid: 'BV1GN4y1k7D2', title: '缩唇呼吸怎么做', up: '知行合一工坊', dur: '4:13',
    desc: '居家缩唇腹式呼吸训练法，借助矿泉水瓶、吸管、纸巾等日常物品辅助，简单易坚持。深吸缓呼可减小气道压力、降低肺残气量。',
    tips: [
      '鼻吸口呼，嘴唇撅起如吹口哨，缓慢呼气 4~6 秒',
      '吸 : 呼 ≈ 1 : 2，尽量把肺泡中的气呼尽',
      '每天 2~3 次（早中晚），每次 10~20 分钟'
    ]
  },
  baduanjin: {
    bvid: 'BV1Z1rZBwEQ6', title: '八段锦功能锻炼', up: '-严小六-', dur: '12:09',
    desc: '健身气功八段锦完整版，带呼吸法与口令引导。动作柔和缓慢、舒展大方，适合居家长期跟练，有助于调和气息、增强体质。',
    tips: [
      '全身放松、意念内守，动作与呼吸自然配合',
      '初学以自然呼吸为主，熟练后逐渐配合呼吸',
      '贵在坚持，不宜急于求成；练习结束注意收功'
    ]
  }
};

const breathPlayer = $('#breathPlayer');
const breathLoading = $('#breathLoading');
let breathCurrent = null;
let breathTimer = null;

function loadBreathCourse(key) {
  const c = BREATH_COURSES[key];
  if (!c) return;
  $('#breathTitle').textContent = c.title;
  $('#breathUp').textContent = c.up;
  $('#breathDur').textContent = c.dur;
  $('#breathBili').href = 'https://www.bilibili.com/video/' + c.bvid;
  $('#breathDesc').innerHTML = '<p>' + c.desc + '</p>';
  $('#breathTips').innerHTML = c.tips.map(t => '<li>' + t + '</li>').join('');
  if (breathCurrent !== c.bvid) {
    breathCurrent = c.bvid;
    breathLoading.classList.remove('hide');
    breathPlayer.src = 'https://player.bilibili.com/player.html?bvid=' + c.bvid +
      '&page=1&high_quality=1&danmaku=0&autoplay=0';
    clearTimeout(breathTimer);
    // 安全兜底：8s 后强制隐藏 loading，避免网络异常时一直转圈
    breathTimer = setTimeout(() => breathLoading.classList.add('hide'), 8000);
  }
}
if (breathPlayer) {
  breathPlayer.addEventListener('load', () => {
    breathLoading.classList.add('hide');
    clearTimeout(breathTimer);
  });
  $$('.breath-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.breath-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadBreathCourse(tab.dataset.course);
    });
  });
  loadBreathCourse('breathing'); // 初始化首个课程
}

/* ---------- 科普讲座屏（B 站网格 + 页内播放器） ---------- */
const LECTURES = [
  // —— 用药方向（聚焦药物本身，不含装置操作演示）——
  { bvid: 'BV1XuSMYkEDF', title: '慢阻肺用药全盘点，收藏！', up: '复旦大学附属华山医院', dur: '33:04',
    pic: 'https://i0.hdslb.com/bfs/archive/ea103c9624128757a0d0994553938d3275be5e81.jpg' },
  { bvid: 'BV1TmsreJEr9', title: '治疗慢阻肺，规律用药是关键！', up: '广东省呼吸与健康学会', dur: '02:52',
    pic: 'https://i1.hdslb.com/bfs/archive/a71e9edfad00a0275e9282b26b0524a0e93a2486.jpg' },
  // —— 疾病认知与防治科普（手动精选）——
  { bvid: 'BV19f4y1y75M', title: '钟南山院士为你讲授慢阻肺的医学知识！', up: '小啊鹿787', dur: '10:08',
    pic: 'https://i1.hdslb.com/bfs/archive/351e1d4e3b73baffcca067696f9855d4721e29be.jpg' },
  { bvid: 'BV1W94y1G7oD', title: 'COPD', up: 'bili_56734700619', dur: '01:25',
    pic: 'https://i2.hdslb.com/bfs/archive/40478cd3f975dc2d7a9931c48c30d3493ecdd5db.jpg' },
  { bvid: 'BV1AestzcEXv', title: '您已"欠肺"！#慢阻肺科普宣传片', up: '深圳移动电视', dur: '02:47',
    pic: 'https://i0.hdslb.com/bfs/archive/2a0e6610b545e0028d56add61bc6bf28233f1280.jpg' },
  { bvid: 'BV1rgk4BUER7', title: '科普：解读慢阻肺（慢性阻塞性肺疾病COPD）', up: '健康新指南', dur: '09:01',
    pic: 'https://i2.hdslb.com/bfs/archive/844cddcba926b8211b31bf9ada6dcb275525be76.jpg' },
  { bvid: 'BV1VLKd6wEwM', title: '慢阻肺病科普宣传视频', up: '江苏灵鲸动画', dur: '03:00',
    pic: 'https://i0.hdslb.com/bfs/archive/ad05edff4af5db0897eca4f41135853d25d43be2.jpg' },
  { bvid: 'BV1yGSnYFEce', title: '【科普动漫】关于慢阻肺，你了解多少', up: '医药卫生网', dur: '02:57',
    pic: 'https://i0.hdslb.com/bfs/archive/52bfc0027a2c5d290c6c326514712f317a897f3c.jpg' }
];

const lecGrid = $('#lecGrid');
if (lecGrid) {
  LECTURES.forEach(v => {
    const card = document.createElement('div');
    card.className = 'lec-card';
    card.innerHTML =
      '<div class="lec-thumb">' +
        '<img class="lec-img" loading="lazy" referrerpolicy="no-referrer" src="' + v.pic + '" alt="' + v.title + '" ' +
          'onerror="this.style.display=\'none\';this.parentNode.classList.add(\'no-img\')">' +
        '<div class="lec-play"><span>▶</span></div>' +
        '<div class="lec-dur">' + v.dur + '</div>' +
      '</div>' +
      '<div class="lec-info">' +
        '<div class="lec-title">' + v.title + '</div>' +
        '<div class="lec-up">' + v.up + '</div>' +
      '</div>';
    card.addEventListener('click', () => openLecPlayer(v));
    lecGrid.appendChild(card);
  });

  const lecPlayer = $('#lecPlayer');
  const lecPlayerFrame = $('#lecPlayerFrame');

  function openLecPlayer(v) {
    $('#lecPlayerTitle').textContent = v.title;
    $('#lecPlayerName').textContent = v.title;
    $('#lecPlayerUp').textContent = v.up;
    $('#lecPlayerBili').href = 'https://www.bilibili.com/video/' + v.bvid;
    // 用户点击触发，autoplay=1 通常可被浏览器放行
    lecPlayerFrame.src = 'https://player.bilibili.com/player.html?bvid=' + v.bvid +
      '&page=1&high_quality=1&danmaku=0&autoplay=1';
    lecPlayer.removeAttribute('hidden');
  }
  function closeLecPlayer() {
    lecPlayerFrame.src = ''; // 停止播放，释放资源
    lecPlayer.setAttribute('hidden', '');
  }
  $('#lecPlayerBack').addEventListener('click', closeLecPlayer);
}

/* ---------- 吸入装置 AI 指导 · 自写聊天 UI（方案 C：后端代理直连 Dify） ---------- */
/* Key 已收回到服务端：前端只调同源 /api/dify/chat，由 server/routes/dify.js 持有 Key 并转发，
   彻底不暴露 Key，且天然绕开浏览器 CORS。配置 Key 请改 server/routes/dify.js 的 DIFY_KEY（或设环境变量 DIFY_API_KEY）。 */

function initInhaleChat() {
  const msgs = $('#chatMsgs');
  const input = $('#chatInput');
  const sendBtn = $('#chatSend');
  if (!msgs || !input || !sendBtn) return;

  let conversationId = '';
  let busy = false;

  const scrollBottom = () => { msgs.scrollTop = msgs.scrollHeight; };

  // 后台预热：进入聊天屏时悄悄发一个最小请求，读到首包即取消，仅用于把 Dify App 提前转热
  // 不渲染、不占用真实会话；失败则允许下次重试。真实发送消息时会 abort 该预热请求释放连接。
  let warmed = false;
  let warmCtrl = null;
  function warmUp() {
    if (warmed || !TOKEN) return;
    warmed = true;
    warmCtrl = new AbortController();
    fetch('/api/dify/chat', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hi', conversation_id: '', inputs: {} }),
      signal: warmCtrl.signal,
    }).then(resp => {
      if (!resp.ok || !resp.body) { warmed = false; return; }
      const reader = resp.body.getReader();
      reader.read().then(() => reader.cancel()).catch(() => {}); // 拿到首个数据包即取消
    }).catch(() => { warmed = false; }); // 失败（含 abort）则放行重预热
  }
  window.__inhaleWarmUp = warmUp;

  // 安全 Markdown 渲染：先 escapeHtml 防 XSS，再解析常用子集
  // 支持：**加粗** *斜体* ~~删除线~~ `代码` 标题 有序/无序列表 引用 链接 围栏代码块
  function mdInline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '@@C' + (codes.length - 1) + '@@'; });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, url) => {
      const safe = /^(https?:\/\/|mailto:|\/)/i.test(url) ? url : '#';
      return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + t + '</a>';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/@@C(\d+)@@/g, (m, i) => '<code>' + escapeHtml(codes[+i]) + '</code>');
    return s;
  }

  function renderMarkdown(src) {
    if (!src) return '';
    const blocks = [];
    let text = src.replace(/```([\s\S]*?)```/g, (m, code) => {
      blocks.push(code.replace(/^\n/, '').replace(/\n$/, ''));
      return '@@CODE' + (blocks.length - 1) + '@@';
    });
    text = escapeHtml(text);
    const lines = text.split('\n');
    let html = '', inList = null, listItems = [], inQuote = false, quoteBuf = [], paraBuf = [];
    const flushPara = () => { if (paraBuf.length) { html += '<p>' + mdInline(paraBuf.join('<br>')) + '</p>'; paraBuf = []; } };
    const flushList = () => { if (inList) { html += '<' + inList + '>' + listItems.map(li => '<li>' + mdInline(li) + '</li>').join('') + '</' + inList + '>'; inList = null; listItems = []; } };
    const flushQuote = () => { if (inQuote) { html += '<blockquote>' + quoteBuf.map(q => mdInline(q)).join('<br>') + '</blockquote>'; inQuote = false; quoteBuf = []; } };
    for (const raw of lines) {
      const cm = raw.match(/^@@CODE(\d+)@@$/);
      if (cm) { flushPara(); flushList(); flushQuote(); html += '<pre><code>' + escapeHtml(blocks[+cm[1]]) + '</code></pre>'; continue; }
      if (/^\s*$/.test(raw)) { flushPara(); flushList(); flushQuote(); continue; }
      const h = raw.match(/^(#{1,4})\s+(.*)$/);
      if (h) { flushPara(); flushList(); flushQuote(); html += '<h' + h[1].length + '>' + mdInline(h[2]) + '</h' + h[1].length + '>'; continue; }
      const q = raw.match(/^&gt;\s?(.*)$/);
      if (q) { flushPara(); flushList(); if (!inQuote) inQuote = true; quoteBuf.push(q[1]); continue; }
      const ul = raw.match(/^\s*[-*]\s+(.*)$/);
      if (ul) { flushPara(); flushQuote(); if (inList && inList !== 'ul') flushList(); inList = 'ul'; listItems.push(ul[1]); continue; }
      const ol = raw.match(/^\s*\d+\.\s+(.*)$/);
      if (ol) { flushPara(); flushQuote(); if (inList && inList !== 'ol') flushList(); inList = 'ol'; listItems.push(ol[1]); continue; }
      flushList(); flushQuote(); paraBuf.push(raw);
    }
    flushPara(); flushList(); flushQuote();
    html = html.replace(/@@CODE(\d+)@@/g, (m, i) => '<pre><code>' + escapeHtml(blocks[+i]) + '</code></pre>');
    return html;
  }

  function addMsg(role, text) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-msg ' + role;
    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = role === 'bot' ? '🫁' : '张';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const content = document.createElement('div');
    content.className = 'chat-content';
    content.innerHTML = renderMarkdown(text);
    bubble.appendChild(content);
    wrap.append(avatar, bubble);
    msgs.appendChild(wrap);
    scrollBottom();
    return bubble;
  }

  async function send(query) {
    if (busy) return;
    busy = true;
    sendBtn.disabled = true;
    if (warmCtrl) { try { warmCtrl.abort(); } catch (e) {} } // 释放预热连接，留给真实对话
    addMsg('user', query);
    input.value = '';
    autoGrow();

    const bubble = addMsg('bot', '');
    const caret = document.createElement('span');
    caret.className = 'caret';
    bubble.appendChild(caret);
    // 初始显示「思考中…」而非空泡，避免 TTFT 期间看起来像没在流式
    bubble.querySelector('.chat-content').innerHTML = '<span class="thinking">思考中…</span>';

    try {
      const resp = await fetch('/api/dify/chat', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          conversation_id: conversationId,
          inputs: {},
        }),
      });

      if (!resp.ok) {
        const errTxt = await resp.text().catch(() => '');
        throw new Error('HTTP ' + resp.status + (errTxt ? ' · ' + errTxt.slice(0, 140) : ''));
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let full = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;
          let data;
          try { data = JSON.parse(jsonStr); } catch { continue; }
          if (data.conversation_id) conversationId = data.conversation_id;
          if ((data.event === 'message' || data.event === 'agent_message') && data.answer) {
            caret.remove();
            // Dify workflow 首条 message 常为「正在生成/请稍等」占位串，作为瞬时思考态展示、不计入最终答案
            const isThinking = !full && /生成|稍等|思考|正在|请等待|等待|loading|thinking/i.test(data.answer);
            if (isThinking) {
              bubble.querySelector('.chat-content').innerHTML = '<span class="thinking">' + escapeHtml(data.answer) + '</span>';
            } else {
              full += data.answer;
              bubble.querySelector('.chat-content').innerHTML = renderMarkdown(full);
            }
            bubble.appendChild(caret);
            scrollBottom();
          } else if (data.event === 'error') {
            throw new Error(data.message || 'Dify 返回错误');
          }
        }
      }
    } catch (e) {
      bubble.remove();
      addMsg('bot', '⚠️ 连接失败：' + e.message + '\n请检查服务端 server/routes/dify.js 的 DIFY_KEY 是否已配置，以及网络连接。');
    } finally {
      caret.remove();
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  sendBtn.addEventListener('click', () => {
    const q = input.value.trim();
    if (q) send(q);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const q = input.value.trim();
      if (q) send(q);
    }
  });
  input.addEventListener('input', autoGrow);

  // 首屏欢迎语
  addMsg('bot', '您好，我是吸入装置 AI 指导助手 👩‍⚕️\n您可以咨询各类吸入剂的正确使用方法、操作步骤、清洁保养与注意事项。请问有什么可以帮您？');
}
initInhaleChat();

/* ---------- 启动 ---------- */
/* ---------- 首页日期（实时本地时间） ---------- */
function renderHomeDate() {
  const el = document.getElementById('homeDate');
  if (!el) return;
  const now = new Date();
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][now.getDay()];
  el.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${week}`;
}

function scheduleDateRefresh() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => {
    renderHomeDate();
    scheduleDateRefresh(); // 跨天自动刷新，无需重新加载页面
  }, nextMidnight - now);
}

async function init() {
  bindAuthUI();
  bindNotificationsUI();
  renderHomeDate();
  scheduleDateRefresh();
  if (TOKEN) {
    await loadAll();
  } else {
    showAuth('login');
  }
}
init();
