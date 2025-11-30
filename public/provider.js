// provider.js (patched) ----------------------------------------------------

/* =================
   STORAGE & DEVICE
   ================= */
// canonical + fallback keys
const STORAGE_KEYS = ['ecocompute_jobs_v1', 'jobs'];
const PROVIDER_KEY = 'ecocompute_provider_v1';

function readJobsFromStorage() {
    for (const k of STORAGE_KEYS) {
        try {
            const raw = localStorage.getItem(k);
            if (!raw) continue;
            const parsed = JSON.parse(raw || '[]');
            if (Array.isArray(parsed)) return parsed;
        } catch (e) { /* ignore and try next */ }
    }
    return [];
}
function writeJobsToStorage(jobs) {
    try {
        localStorage.setItem(STORAGE_KEYS[0], JSON.stringify(jobs));
    } catch (e) { console.error('Failed to write jobs to storage', e); }
}

/* =================
   DEVICE / UI
   ================= */
let deviceId = localStorage.getItem('eco_device_id') || crypto.randomUUID();
localStorage.setItem('eco_device_id', deviceId);
if (document.getElementById('deviceId')) document.getElementById('deviceId').innerText = deviceId;

const cores = navigator.hardwareConcurrency || 2;
if (document.getElementById('cores')) document.getElementById('cores').innerText = cores;

let workerPool = [];
let workerBlobURL = null;
let poolSize = Math.max(1, Math.min(6, cores - 1));
if (document.getElementById('assignedCount')) document.getElementById('assignedCount').innerText = 'Assigned: 0';
if (document.getElementById('runningCount')) document.getElementById('runningCount').innerText = 'Running: 0';
if (document.getElementById('completedCount')) document.getElementById('completedCount').innerText = 'Done: 0';

let sharingOn = false;
let dispatchInterval = null;
let processedCount = 0;

/* ================= BATTERY ================ */
let batteryLevel = null;
let charging = null;
async function readBattery() {
    if (navigator.getBattery) {
        try {
            const b = await navigator.getBattery();
            batteryLevel = Math.round(b.level * 100);
            charging = b.charging;
            if (document.getElementById('battery')) document.getElementById('battery').innerText = batteryLevel + '%';
            if (document.getElementById('charging')) document.getElementById('charging').innerText = charging ? 'Yes' : 'No';
            b.addEventListener('levelchange', () => { batteryLevel = Math.round(b.level * 100); if (document.getElementById('battery')) document.getElementById('battery').innerText = batteryLevel + '%'; });
            b.addEventListener('chargingchange', () => { charging = b.charging; if (document.getElementById('charging')) document.getElementById('charging').innerText = charging ? 'Yes' : 'No'; });
        } catch (e) {
            if (document.getElementById('battery')) document.getElementById('battery').innerText = 'unavailable';
            if (document.getElementById('charging')) document.getElementById('charging').innerText = 'unknown';
        }
    } else {
        if (document.getElementById('battery')) document.getElementById('battery').innerText = 'unsupported';
        if (document.getElementById('charging')) document.getElementById('charging').innerText = 'unknown';
    }
}

/* ================= LOGGING ================ */
function log(s) {
    const el = document.getElementById('log');
    const t = new Date().toLocaleTimeString();
    if (el) el.textContent = `[${t}] ${s}\n` + el.textContent;
    else console.log(`[${t}] ${s}`);
}

/* ================= BENCHMARK ================ */
if (document.getElementById('runBench')) {
    document.getElementById('runBench').onclick = async () => {
        const score = await runBench();
        if (document.getElementById('score')) document.getElementById('score').innerText = score;
        log('Benchmark finished — score ' + score);
    };
}
function runBench() {
    return new Promise(resolve => {
        const code = `self.onmessage = function(){ const N = 1200000; const s=performance.now(); let x=0; for(let i=0;i<N;i++){ x+=Math.sqrt(i%200+1) } self.postMessage(performance.now()-s) }`;
        const blob = new Blob([code], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const w = new Worker(url);
        w.onmessage = (e) => {
            URL.revokeObjectURL(url);
            const dur = e.data;
            const score = Math.max(5, Math.round((2000 / dur) * 100));
            resolve(score);
        };
        w.postMessage({});
    });
}

/* ================= WORKER POOL & KERNEL ================ */
/* timeout/retry config */
const TASK_TIMEOUT_MS = 20000; // 20s
const MAX_ATTEMPTS = 3;
const taskTimeouts = new Map(); // taskId -> timeoutId

function createWorkerBlobURL() {
    const code = `
    self.onmessage = function(e){
      const { jobId, taskId, payload } = e.data;
      let result;
      try {
        if (Array.isArray(payload)) {
          result = payload.map(v => (typeof v === 'number' ? v * v : v));
        } else if (payload && payload.items && Array.isArray(payload.items)) {
          result = payload.items.map(v => (typeof v === 'number' ? v * v : v));
        } else {
          result = payload;
        }
      } catch(err) {
        result = { __error: err.message };
      }
      const wait = 200 + Math.floor(Math.random() * 600);
      setTimeout(()=> self.postMessage({ jobId, taskId, result }), wait);
    }
  `;
    if (workerBlobURL) try { URL.revokeObjectURL(workerBlobURL); } catch (e) { }
    workerBlobURL = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    return workerBlobURL;
}

function initWorkerPool(size) {
    terminatePool();
    workerPool = [];
    createWorkerBlobURL();
    for (let i = 0; i < size; i++) {
        const w = new Worker(workerBlobURL);
        w.onmessage = onWorkerDoneRobust;
        workerPool.push({ worker: w, busy: false, id: 'w' + i, current: null });
    }
    log('Worker pool started: ' + workerPool.length + ' workers');
}

function terminatePool() {
    if (workerPool.length) {
        for (const p of workerPool) { try { p.worker.terminate(); } catch (e) { } }
        workerPool = [];
    }
    if (workerBlobURL) { try { URL.revokeObjectURL(workerBlobURL); } catch (e) { } workerBlobURL = null; }
    for (const t of taskTimeouts.values()) clearTimeout(t);
    taskTimeouts.clear();
}

/* ================= DISPATCH (robust) ================ */
function dispatchOnceRobust() {
    const requireCharging = document.getElementById('requireCharging') ? document.getElementById('requireCharging').checked : false;
    const minBattery = document.getElementById('minBattery') ? parseInt(document.getElementById('minBattery').value || '0') : 0;
    if (requireCharging && charging === false) { log('Paused: not charging'); return; }
    if (minBattery > 0 && batteryLevel !== null && batteryLevel < minBattery) { log('Paused: battery below min ' + minBattery + '%'); return; }

    const freeSlot = workerPool.find(w => !w.busy);
    if (!freeSlot) return;

    const jobs = readJobsFromStorage();

    for (const job of jobs) {
        if (!Array.isArray(job.microtasks)) continue;

        // prefer pending tasks with attempts left
        let mt = job.microtasks.find(t => t.status === 'pending' && (t.attempts || 0) < (t.maxAttempts || MAX_ATTEMPTS));
        if (!mt) {
            // requeue assigned that timed out
            const now = Date.now();
            mt = job.microtasks.find(t => t.status === 'assigned' && t.assignedAt && (now - new Date(t.assignedAt).getTime()) > TASK_TIMEOUT_MS && (t.attempts || 0) < (t.maxAttempts || MAX_ATTEMPTS));
            if (mt) {
                mt.status = 'pending';
                mt.assignedTo = null;
                mt.assignedAt = null;
            } else {
                continue; // no eligible task in this job
            }
        }

        // assign
        mt.status = 'assigned';
        mt.assignedTo = deviceId;
        mt.assignedAt = new Date().toISOString();
        mt.attempts = (mt.attempts || 0) + 1;
        job.logs = job.logs || [];
        job.logs.push(`[${new Date().toISOString()}] Assigned ${mt.id} to ${deviceId}`);

        // persist immediately (write back to canonical key)
        const idx = jobs.findIndex(j => j.id === job.id);
        jobs[idx] = job;
        writeJobsToStorage(jobs);
        updateJobsTable();

        // mark worker busy and set current
        freeSlot.busy = true;
        freeSlot.current = { jobId: job.id, taskId: mt.id };
        if (document.getElementById('assignedCount')) document.getElementById('assignedCount').innerText = 'Assigned: ' + countAssigned();
        if (document.getElementById('runningCount')) document.getElementById('runningCount').innerText = 'Running: ' + countRunning();

        // prepare payload
        let payloadToProcess = mt.payload;
        if (!payloadToProcess) {
            try {
                if (job.payload && job.payload.mode === 'text') {
                    const parsed = JSON.parse(job.payload.raw);
                    const items = parsed.items || parsed;
                    const parts = mt.id.split('::task::');
                    const idxNum = parts.length > 1 ? parseInt(parts[1]) : 0;
                    const start = idxNum * (job.chunkSize || 1);
                    payloadToProcess = items.slice(start, start + job.chunkSize);
                } else if (job.payload && job.payload.mode === 'file' && job.payload.file && job.payload.file.text) {
                    const parsed = JSON.parse(job.payload.file.text);
                    const items = parsed.items || parsed;
                    const parts = mt.id.split('::task::');
                    const idxNum = parts.length > 1 ? parseInt(parts[1]) : 0;
                    const start = idxNum * (job.chunkSize || 1);
                    payloadToProcess = items.slice(start, start + job.chunkSize);
                } else {
                    payloadToProcess = mt.payload || job.payload || null;
                }
            } catch (e) {
                payloadToProcess = mt.payload || job.payload || null;
            }
        }

        // set timeout for this task
        if (taskTimeouts.has(mt.id)) { clearTimeout(taskTimeouts.get(mt.id)); taskTimeouts.delete(mt.id); }
        const timeoutId = setTimeout(() => {
            const saved = readJobsFromStorage();
            const sj = saved.find(s => s.id === job.id);
            if (!sj) return;
            const sMt = sj.microtasks.find(m => m.id === mt.id);
            if (!sMt) return;

            if ((sMt.attempts || 0) >= (sMt.maxAttempts || MAX_ATTEMPTS)) {
                sMt.status = 'failed';
                sj.logs = sj.logs || [];
                sj.logs.push(`[${new Date().toISOString()}] microtask ${sMt.id} failed (max attempts)`);
            } else {
                sMt.status = 'pending';
                sMt.assignedTo = null;
                sMt.assignedAt = null;
                sj.logs = sj.logs || [];
                sj.logs.push(`[${new Date().toISOString()}] microtask ${sMt.id} timed out — requeued`);
            }
            const i = saved.findIndex(x => x.id === sj.id); saved[i] = sj;
            writeJobsToStorage(saved);

            if (freeSlot && freeSlot.current && freeSlot.current.taskId === mt.id) {
                freeSlot.busy = false;
                freeSlot.current = null;
            }
            taskTimeouts.delete(mt.id);
            updateJobsTable();
        }, TASK_TIMEOUT_MS);
        taskTimeouts.set(mt.id, timeoutId);

        // send to worker
        try {
            freeSlot.worker.postMessage({ jobId: job.id, taskId: mt.id, payload: payloadToProcess });
            log(`Dispatched ${mt.id} from job ${job.title || job.id} -> worker ${freeSlot.id}`);
        } catch (err) {
            log('Worker postMessage failed: ' + err.message);
            freeSlot.busy = false;
            mt.status = 'pending';
            mt.assignedTo = null;
            const jidx = jobs.findIndex(j => j.id === job.id);
            jobs[jidx] = job;
            writeJobsToStorage(jobs);
        }

        // assigned one task this dispatch tick
        break;
    }
}

/* ================= WORKER DONE (robust) ================ */
function onWorkerDoneRobust(ev) {
    const { jobId, taskId, result } = ev.data;

    // clear timeout
    if (taskTimeouts.has(taskId)) { clearTimeout(taskTimeouts.get(taskId)); taskTimeouts.delete(taskId); }

    // free worker that matched this task
    const p = workerPool.find(w => w.current && w.current.jobId === jobId && w.current.taskId === taskId);
    if (p) { p.busy = false; p.current = null; }

    // update job in storage
    const jobs = readJobsFromStorage();
    const job = jobs.find(j => j.id === jobId);
    if (!job) {
        log('Finished task but job not found: ' + jobId);
        return;
    }
    const mt = job.microtasks && job.microtasks.find(t => t.id === taskId);
    if (!mt) {
        log('Finished task but microtask not found: ' + taskId);
        return;
    }

    // record response (for redundancy)
    mt.responses = mt.responses || [];
    mt.responses.push({ deviceId, result, at: new Date().toISOString() });

    // simple redundancy: if redundancy <=1 accept first response
    const redundancy = job.redundancy || 1;
    if (redundancy <= 1) {
        mt.status = 'completed';
        mt.result = result;
        mt.completedAt = new Date().toISOString();
        job.logs = job.logs || [];
        job.logs.push(`[${new Date().toISOString()}] Microtask ${taskId} completed by ${deviceId}`);
    } else {
        // majority accept
        const groups = {};
        for (const r of mt.responses) {
            const k = safeStringify(r.result);
            groups[k] = (groups[k] || 0) + 1;
        }
        let bestKey = null, bestCount = 0;
        for (const k in groups) if (groups[k] > bestCount) { bestKey = k; bestCount = groups[k]; }
        if (bestCount >= Math.ceil(redundancy / 2)) {
            try { mt.result = JSON.parse(bestKey); } catch (e) { mt.result = bestKey; }
            mt.status = 'completed';
            mt.completedAt = new Date().toISOString();
            job.logs = job.logs || [];
            job.logs.push(`[${new Date().toISOString()}] Microtask ${taskId} accepted by majority (${bestCount})`);
        } else {
            mt.status = 'assigned'; // wait for more responses if needed
            job.logs = job.logs || [];
            job.logs.push(`[${new Date().toISOString()}] Microtask ${taskId} response recorded (${mt.responses.length})`);
        }
    }

    // update counts & persist
    job.completedMicrotasks = job.microtasks.filter(t => t.status === 'completed').length;
    job.progress = Math.round((job.completedMicrotasks / job.totalMicrotasks) * 100);

    // --- AGGREGATE & MARK JOB COMPLETED WHEN ALL MICROTASKS DONE ---
    const total = job.totalMicrotasks || job.estimatedMicrotasks || (job.microtasks && job.microtasks.length) || 0;
    if (total > 0 && job.completedMicrotasks === total && job.status !== 'completed') {
        // collect results (task-order)
        const aggregated = job.microtasks.map(m => m.result !== undefined ? m.result : null);
        job.finalResult = {
            aggregatedByTask: aggregated,
            summary: { totalMicrotasks: total, completed: job.completedMicrotasks, timestamp: new Date().toISOString() }
        };
        job.status = 'completed';
        job.logs = job.logs || [];
        job.logs.push(`[${new Date().toISOString()}] Job completed; final result saved in job.finalResult`);
    }

    const idx = jobs.findIndex(j => j.id === job.id); jobs[idx] = job;
    writeJobsToStorage(jobs);

    processedCount++;
    if (document.getElementById('completedCount')) document.getElementById('completedCount').innerText = 'Done: ' + processedCount;
    if (document.getElementById('assignedCount')) document.getElementById('assignedCount').innerText = 'Assigned: ' + countAssigned();
    if (document.getElementById('runningCount')) document.getElementById('runningCount').innerText = 'Running: ' + countRunning();
    updateJobsTable();
    log(`Completed ${taskId} from ${job.title || job.id}`);
}

/* ================= HELPERS ================ */
function countAssigned() {
    const jobs = readJobsFromStorage();
    let c = 0;
    for (const j of jobs) if (Array.isArray(j.microtasks)) c += j.microtasks.filter(t => t.status === 'assigned' && t.assignedTo === deviceId).length;
    return c;
}
function countRunning() {
    return workerPool.filter(w => w.busy).length;
}
function escapeHtml(s) { if (s === null || s === undefined) return ''; return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function safeStringify(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }

/* ================= START / STOP SHARING ================ */
function startSharing() {
    if (sharingOn) return;
    sharingOn = true;
    if (document.getElementById('toggleShare')) document.getElementById('toggleShare').innerText = 'Stop Sharing';
    runBench().then(score => { if (document.getElementById('score')) document.getElementById('score').innerText = score; });
    initWorkerPool(poolSize);
    if (dispatchInterval) clearInterval(dispatchInterval);
    dispatchInterval = setInterval(dispatchOnceRobust, 1000);
    log('Sharing ON — dispatch loop started');
}
function stopSharing() {
    if (!sharingOn) return;
    sharingOn = false;
    if (document.getElementById('toggleShare')) document.getElementById('toggleShare').innerText = 'Start Sharing';
    if (dispatchInterval) clearInterval(dispatchInterval);
    dispatchInterval = null;
    terminatePool();
    log('Sharing OFF — dispatch stopped');
}
if (document.getElementById('toggleShare')) {
    document.getElementById('toggleShare').onclick = async () => { if (!sharingOn) startSharing(); else stopSharing(); };
}

/* ================= UI JOBS TABLE ================ */
function updateJobsTable() {
    const jobs = readJobsFromStorage();
    const body = document.getElementById('jobsBody');
    if (!body) return;
    body.innerHTML = '';
    for (const job of jobs) {
        const pending = Array.isArray(job.microtasks) ? job.microtasks.filter(t => t.status === 'pending').length : job.estimatedMicrotasks || 0;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(job.title)}</td><td>${escapeHtml(job.type)}</td><td>${job.totalMicrotasks || job.estimatedMicrotasks || '-'}</td><td>${new Date(job.createdAt).toLocaleString()}</td><td>${pending}</td>`;
        body.appendChild(tr);
    }
}
// auto-refresh jobs when localStorage changes from other tabs (tolerant to either key)
window.addEventListener('storage', (e) => {
    if (STORAGE_KEYS.includes(e.key)) {
        try { updateJobsTable(); log('Jobs updated via storage event'); } catch (err) { console.error(err); }
    }
});

/* ================= INIT ================ */
readBattery();
updateJobsTable();
log('Provider dashboard ready.');
window._ec_refreshJobs = updateJobsTable;

// end of provider.js -------------------------------------------------------
