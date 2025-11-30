/* ============================
   Storage key
   ============================ */
const STORAGE_KEY = 'ecocompute_jobs_v1';

/* ============================
   Split job into microtasks (generic for "items" mode)
   ============================ */
function splitIntoMicrotasks(job, items) {
    const chunkSize = Math.max(1, parseInt(job.chunkSize) || 1);
    const total = Math.max(1, Math.ceil(items.length / chunkSize));
    job.totalMicrotasks = total;
    job.completedMicrotasks = 0;
    job.microtasks = [];

    for (let i = 0; i < total; i++) {
        const slice = items.slice(i * chunkSize, i * chunkSize + chunkSize);

        const mt = {
            id: `${job.id}::task::${i}`,   // unique deterministic id
            index: i,
            payload: slice,                // payload for provider to compute
            status: 'pending',             // pending | assigned | running | completed | failed
            assignedTo: null,
            assignedAt: null,
            attempts: 0,
            maxAttempts: 3,
            responses: [],                 // for redundancy: store { deviceId, result, at }
            result: null,
            createdAt: new Date().toISOString()
        };
        job.microtasks.push(mt);
    }

    return job;
}

/* ============================
   UI helpers
   ============================ */
function showJobForm() { document.getElementById('jobForm').classList.add('active'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function hideJobForm() { document.getElementById('jobForm').classList.remove('active'); }
function toggleInputMode(mode) {
    document.getElementById('textInputBlock').style.display = mode === 'text' ? '' : 'none';
    document.getElementById('fileInputBlock').style.display = mode === 'file' ? '' : 'none';
    // if switching to text mode, keep separate matrices toggle state
    calculateEstimate();
}
function setFileInfo(text) { document.getElementById('fileInfo').innerText = text; }

/* NEW: Separate matrices UI toggle */
function toggleSeparateMatrices() {
    const useSeparate = !!document.getElementById('separateMatricesToggle').checked;
    document.getElementById('separateMatricesBlock').style.display = useSeparate ? 'flex' : 'none';
    document.getElementById('textInputBlock').style.display = useSeparate ? 'none' : '';
    calculateEstimate();
}

/* helper: safe JSON parse */
function tryParseJSON(s) {
    try { return JSON.parse(s); } catch (e) { return null; }
}

/* read matrices when using separate fields or the single JSON block */
function readMatricesFromInputIfPresent() {
    const useSeparate = !!document.getElementById('separateMatricesToggle').checked;
    if (useSeparate) {
        const aRaw = document.getElementById('matrixAInput').value.trim();
        const bRaw = document.getElementById('matrixBInput').value.trim();
        const A = tryParseJSON(aRaw);
        const B = tryParseJSON(bRaw);
        if (Array.isArray(A) && Array.isArray(B)) return { mode: 'matrix', A, B };
        return null;
    } else {
        const raw = document.getElementById('inputData').value.trim();
        if (!raw) return null;
        const parsed = tryParseJSON(raw);
        if (parsed && parsed.A && parsed.B && Array.isArray(parsed.A) && Array.isArray(parsed.B)) {
            return { mode: 'matrix', A: parsed.A, B: parsed.B };
        }
        return null;
    }
}

/* ============================
   File handling: store file as data URL or text
   ============================ */
let stagedFile = null; // { name, type, size, dataUrl OR text }

function handleFileSelect(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) { stagedFile = null; setFileInfo('No file selected'); return; }
    const reader = new FileReader();
    // If image or other binary, store as dataURL; if text/json store as text
    const isText = f.type.startsWith('text') || f.type === 'application/json' || f.name.endsWith('.json');
    reader.onload = () => {
        if (isText) {
            stagedFile = { name: f.name, type: f.type || 'text', size: f.size, text: reader.result };
            setFileInfo(`Loaded text file: ${f.name} (${f.size} bytes)`);
        } else {
            stagedFile = { name: f.name, type: f.type || 'binary', size: f.size, dataUrl: reader.result };
            setFileInfo(`Loaded file: ${f.name} (${f.size} bytes)`);
        }
        calculateEstimate(); // estimate can use file content if JSON
    };
    if (isText) reader.readAsText(f);
    else reader.readAsDataURL(f);
}

/* ============================
   Estimate microtasks from text or file
   Supports: normal items[] mode OR matrix mode { A, B } and separate matrices inputs
   ============================ */
function calculateEstimate() {
    const chunkSize = parseInt(document.getElementById('chunkSize').value) || 0;
    const mode = document.querySelector('input[name="inputMode"]:checked').value;
    if (chunkSize <= 0) { document.getElementById('estimateBox').style.display = 'none'; return; }

    // First check if matrices are provided (either separate or single JSON)
    const matrixPayload = readMatricesFromInputIfPresent();
    if (matrixPayload && matrixPayload.mode === 'matrix') {
        const totalRows = matrixPayload.A.length || 0;
        const estimate = Math.max(1, Math.ceil(totalRows / chunkSize));
        document.getElementById('estimateValue').textContent = estimate;
        document.getElementById('estimateBox').style.display = 'block';
        return;
    }

    // fallback to existing text/file parsing for items
    let totalItems = 0;
    if (mode === 'text') {
        const raw = document.getElementById('inputData').value.trim();
        if (!raw) { document.getElementById('estimateBox').style.display = 'none'; return; }
        try {
            const parsed = JSON.parse(raw);
            const items = parsed.items || parsed;
            totalItems = Array.isArray(items) ? items.length : 1;
        } catch (e) {
            totalItems = raw.split('\n').filter(l => l.trim()).length;
        }
    } else {
        if (!stagedFile) { document.getElementById('estimateBox').style.display = 'none'; return; }
        if (stagedFile.text) {
            try {
                const parsed = JSON.parse(stagedFile.text);
                const items = parsed.items || parsed;
                totalItems = Array.isArray(items) ? items.length : 1;
            } catch (e) {
                totalItems = stagedFile.text.split('\n').filter(l => l.trim()).length;
            }
        } else {
            totalItems = 1;
        }
    }

    const estimate = Math.max(1, Math.ceil(totalItems / chunkSize));
    document.getElementById('estimateValue').textContent = estimate;
    document.getElementById('estimateBox').style.display = 'block';
}

/* ============================
   Create & Save Job
   - Supports matrix-mode {A,B} from either single input OR separate matrices
   ============================ */
function createJob(e) {
    e.preventDefault();
    const title = document.getElementById('jobTitle').value.trim();
    const description = document.getElementById('jobDescription').value.trim();
    const type = document.getElementById('jobType').value;
    const chunkSize = Math.max(1, parseInt(document.getElementById('chunkSize').value));
    const redundancy = parseInt(document.getElementById('redundancy').value);
    const priority = document.getElementById('priority').value;
    const budget = document.getElementById('budget').value || null;

    if (!title || !description || !type || !chunkSize) return alert('Please fill required fields.');

    // Prepare input payload depending on input mode
    const mode = document.querySelector('input[name="inputMode"]:checked').value;
    let items = [];
    let isMatrixMode = false;
    let matrixA = null;
    let matrixB = null;

    // detect matrix payload first (either separate fields or single JSON containing A & B)
    const matrixPayload = readMatricesFromInputIfPresent();
    if (matrixPayload && matrixPayload.mode === 'matrix') {
        isMatrixMode = true;
        matrixA = matrixPayload.A;
        matrixB = matrixPayload.B;
    } else {
        // fallback: handle text or file as before
        if (mode === 'text') {
            const raw = document.getElementById('inputData').value.trim();
            if (!raw) return alert('Please provide input data (paste JSON or lines).');
            try {
                const parsed = JSON.parse(raw);
                const parsedItems = parsed.items || parsed;
                items = Array.isArray(parsedItems) ? parsedItems : [parsedItems];
            } catch (err) {
                items = raw.split('\n').map(l => l.trim()).filter(Boolean);
            }
        } else {
            if (!stagedFile) return alert('Please upload a file.');
            if (stagedFile.text) {
                try {
                    const parsed = JSON.parse(stagedFile.text);
                    const parsedItems = parsed.items || parsed;
                    items = Array.isArray(parsedItems) ? parsedItems : [parsedItems];
                } catch (err) {
                    items = stagedFile.text.split('\n').map(l => l.trim()).filter(Boolean);
                }
            } else {
                items = [{ file: stagedFile }];
            }
        }
    }

    // Build job object
    const jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

    const job = {
        id: 'job_' + Date.now(),
        title,
        description,
        type,
        chunkSize,
        redundancy,
        priority,
        budget,
        createdAt: new Date().toISOString(),
        status: 'created',
        estimatedMicrotasks: 0,
        payload: null,
        logs: [`[${new Date().toISOString()}] Job created`]
    };

    if (isMatrixMode) {
        // Save payload as matrices
        job.payload = { mode: 'matrix', A: matrixA, B: matrixB };
        job.estimatedMicrotasks = matrixA.length;
        // Build microtasks: one microtask per row of A (each contains A_row and whole B)
        job.totalMicrotasks = matrixA.length;
        job.completedMicrotasks = 0;
        job.microtasks = matrixA.map((row, i) => ({
            id: `${job.id}::task::${i}`,
            index: i,
            payload: { rowIndex: i, A_row: row, B: matrixB },
            status: 'pending',
            assignedTo: null,
            assignedAt: null,
            attempts: 0,
            maxAttempts: 3,
            responses: [],
            result: null,
            createdAt: new Date().toISOString()
        }));
    } else {
        // Normal mode: store payload and split into microtasks using existing slice logic
        job.payload = (mode === 'text') ? { mode: 'text', raw: (document.getElementById('inputData').value.trim()) } : { mode: 'file', file: stagedFile };
        job.estimatedMicrotasks = Math.max(1, Math.ceil(items.length / Math.max(1, chunkSize)));
        splitIntoMicrotasks(job, items);
    }

    // Save to localStorage
    jobs.unshift(job);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));

    // reset form & UI
    document.getElementById('jobFormEl').reset();
    stagedFile = null; setFileInfo('');
    document.getElementById('estimateBox').style.display = 'none';
    hideJobForm();
    loadJobs();
    alert('Job saved locally and split into ' + (job.totalMicrotasks || job.estimatedMicrotasks) + ' microtasks.');
}

/* ============================
   Demo generator (matrix demo included)
   ============================ */
function generateDemo() {
    // A small matrix demo 4x3 * 3x2 => result 4x2
    const demo = {
        A: [
            [1, 2, 3],
            [4, 5, 6],
            [7, 8, 9],
            [2, 3, 4]
        ],
        B: [
            [7, 8],
            [9, 10],
            [11, 12]
        ]
    };
    // fill form
    document.getElementById('jobTitle').value = 'Demo Matrix Multiply Job';
    document.getElementById('jobDescription').value = 'Compute A x B distributed by row';
    document.getElementById('jobType').value = 'batch-compute';
    document.getElementById('chunkSize').value = 1;

    // enable separate matrices mode and fill
    try {
        document.getElementById('separateMatricesToggle').checked = true;
        toggleSeparateMatrices();
        document.getElementById('matrixAInput').value = JSON.stringify(demo.A, null, 2);
        document.getElementById('matrixBInput').value = JSON.stringify(demo.B, null, 2);
    } catch (e) {
        // fallback to single textarea
        document.getElementById('inputData').value = JSON.stringify(demo, null, 2);
        toggleInputMode('text');
    }

    calculateEstimate();
}

/* ============================
   Load and display jobs list
   ============================ */
function loadJobs() {
    const jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const list = document.getElementById('jobList');
    if (!jobs || jobs.length === 0) {
        list.innerHTML = '<div class="empty-state">No jobs yet — create one.</div>';
        return;
    }
    list.innerHTML = '';
    for (const job of jobs) {
        const card = document.createElement('div');
        card.className = 'job-card';
        const statusClass = job.status === 'created' ? 'status-pending' :
            job.status === 'queued' ? 'status-running' :
                job.status === 'completed' ? 'status-completed' : 'status-pending';

        // show a small download button if completed
        const downloadBtn = (job.status === 'completed' && job.finalResult) ?
            `<button class="btn-action" onclick="downloadFinalResult('${job.id}')">Download Result</button>` : '';

        card.innerHTML = `
      <div class="job-header">
        <div style="flex:1">
          <div class="job-title">${escapeHtml(job.title)}</div>
          <div class="job-meta">${escapeHtml(job.type)} • est ${job.estimatedMicrotasks || job.totalMicrotasks || '-'} microtasks • ${new Date(job.createdAt).toLocaleString()}</div>
        </div>
        <div style="text-align:right">
          <div class="job-meta" style="margin-bottom:8px">Status</div>
          <div class="job-status ${statusClass}">${job.status.toUpperCase()}</div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <div class="job-actions">
          <button class="btn-action" onclick="previewJob('${job.id}')">Preview</button>
          <button class="btn-action" onclick="editJob('${job.id}')">Edit</button>
          <button class="btn-action btn-delete" onclick="deleteJob('${job.id}')">Delete</button>
          ${downloadBtn}
        </div>
        <div style="font-size:12px;color:var(--bg-navy);opacity:.8">Created: ${new Date(job.createdAt).toLocaleDateString()}</div>
      </div>
    `;
        list.appendChild(card);
    }
}

/* ============================
   Preview / Edit / Delete
   ============================ */
let currentPreviewJobId = null;
let modalRefreshTimer = null;

function previewJob(jobId) {
    currentPreviewJobId = jobId;
    const jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const job = jobs.find(j => j.id === jobId);
    if (!job) return alert('Job not found');
    document.getElementById('modalTitle').innerText = job.title;
    document.getElementById('modalMeta').innerText = `${job.type} • ${job.estimatedMicrotasks || job.totalMicrotasks} microtasks • status ${job.status}`;

    // Fill details grid
    const md = document.getElementById('modalDetails');
    md.innerHTML = `
    <div class="detail-item"><div class="detail-label">Title</div><div class="detail-value">${escapeHtml(job.title)}</div></div>
    <div class="detail-item"><div class="detail-label">Type</div><div class="detail-value">${escapeHtml(job.type)}</div></div>
    <div class="detail-item"><div class="detail-label">Chunk size</div><div class="detail-value">${job.chunkSize}</div></div>
    <div class="detail-item"><div class="detail-label">Redundancy</div><div class="detail-value">${job.redundancy}</div></div>
    <div class="detail-item"><div class="detail-label">Priority</div><div class="detail-value">${escapeHtml(job.priority)}</div></div>
    <div class="detail-item"><div class="detail-label">Budget</div><div class="detail-value">${job.budget || '-'}</div></div>
    <div class="detail-item" style="grid-column:1/-1"><div class="detail-label">Description</div><div class="detail-value">${escapeHtml(job.description)}</div></div>
  `;

    // Input preview
    const preview = document.getElementById('inputPreviewArea');
    preview.innerHTML = '';
    if (job.payload && job.payload.mode === 'text') {
        const raw = job.payload.raw;
        try {
            const parsed = JSON.parse(raw);
            const pre = document.createElement('pre'); pre.textContent = JSON.stringify(parsed, null, 2); preview.appendChild(pre);
        } catch (e) {
            const pre = document.createElement('pre'); pre.textContent = raw; preview.appendChild(pre);
        }
    } else if (job.payload && job.payload.mode === 'file') {
        const f = job.payload.file;
        if (f && f.dataUrl && f.type && f.type.startsWith && f.type.startsWith('image')) {
            const img = document.createElement('img'); img.src = f.dataUrl; img.alt = f.name; img.className = 'file-preview';
            preview.appendChild(img);
            const info = document.createElement('div'); info.style.marginTop = '8px'; info.textContent = `${f.name} (${f.type}, ${f.size} bytes)`; preview.appendChild(info);
            const a = document.createElement('a'); a.href = f.dataUrl; a.download = f.name; a.textContent = 'Download file'; a.style.display = 'inline-block'; a.style.marginTop = '8px';
            preview.appendChild(a);
        } else if (f && f.text) {
            try {
                const parsed = JSON.parse(f.text);
                const pre = document.createElement('pre'); pre.textContent = JSON.stringify(parsed, null, 2); preview.appendChild(pre);
            } catch (e) {
                const pre = document.createElement('pre'); pre.textContent = f.text; preview.appendChild(pre);
            }
        } else if (f) {
            const info = document.createElement('div'); info.textContent = `${f.name} (${f.type || 'binary'})`; preview.appendChild(info);
            if (f.dataUrl) {
                const a = document.createElement('a'); a.href = f.dataUrl; a.download = f.name; a.textContent = 'Download file'; a.style.display = 'inline-block'; a.style.marginTop = '8px';
                preview.appendChild(a);
            }
        }
    } else if (job.payload && job.payload.mode === 'matrix') {
        const pre = document.createElement('pre');
        pre.textContent = `Matrix A: ${job.payload.A.length} rows × ${(job.payload.A[0] && job.payload.A[0].length) || '?'} cols\nMatrix B: ${job.payload.B.length} rows × ${(job.payload.B[0] && job.payload.B[0].length) || '?'} cols\n\n(Preview of first rows)\nA[0]: ${JSON.stringify(job.payload.A[0])}\nB[0]: ${JSON.stringify(job.payload.B[0])}`;
        preview.appendChild(pre);
    }

    // render microtasks & final result
    renderMicrotasks(job);
    renderJobFinalResult(job);

    // logs
    const lc = document.getElementById('logContainer'); lc.innerHTML = (job.logs || []).slice().reverse().map(l => `<div style="font-size:12px">${escapeHtml(l)}</div>`).join('');

    // show modal and start auto-refresh
    document.getElementById('modal').classList.add('active');
    startModalAutoRefresh();
}

function closeModal() { document.getElementById('modal').classList.remove('active'); currentPreviewJobId = null; stopModalAutoRefresh(); }

/* ============================
   Microtask rendering & controls
   ============================ */
function renderMicrotasks(job) {
    const tbody = document.getElementById('microtaskBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!job.microtasks || job.microtasks.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="5" style="text-align:center;padding:12px">No microtasks present (job not split)</td>`;
        tbody.appendChild(tr);
        return;
    }

    for (const mt of job.microtasks) {
        const tr = document.createElement('tr');
        const statusLabel = escapeHtml((mt.status || 'pending').toUpperCase());
        const assigned = mt.assignedTo || '-';
        const time = mt.completedAt ? new Date(mt.completedAt).toLocaleString() : (mt.assignedAt ? new Date(mt.assignedAt).toLocaleString() : '-');
        const resultPreview = mt.result !== null ? (typeof mt.result === 'object' ? '[object]' : escapeHtml(String(mt.result)).slice(0, 120)) : '-';
        const attempts = mt.attempts || 0;

        tr.innerHTML = `
      <td style="vertical-align:top"><code style="font-family:monospace">${escapeHtml(mt.id)}</code></td>
      <td>${statusLabel}<div style="font-size:10px;color:gray;margin-top:6px">attempts: ${attempts}</div></td>
      <td>${escapeHtml(assigned)}</td>
      <td>${escapeHtml(time)}</td>
      <td>
        <div style="margin-bottom:6px">${resultPreview}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-action" onclick="showMicrotaskDetails('${job.id}','${mt.id}')">Details</button>
          <button class="btn-action" onclick="downloadMicrotaskResult('${job.id}','${mt.id}')">Download</button>
          <button class="btn-action btn-delete" onclick="forceRerunMicrotask('${job.id}','${mt.id}')">Force Rerun</button>
        </div>
      </td>
    `;
        tbody.appendChild(tr);
    }
}

/* Show details (responses) */
function showMicrotaskDetails(jobId, taskId) {
    const jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const job = jobs.find(j => j.id === jobId);
    if (!job) return alert('Job not found');
    const mt = job.microtasks.find(m => m.id === taskId);
    if (!mt) return alert('Microtask not found');

    // build details HTML
    const lines = [];
    lines.push(`ID: ${mt.id}`);
    lines.push(`Status: ${mt.status}`);
    lines.push(`Attempts: ${mt.attempts || 0}`);
    lines.push(`Assigned To: ${mt.assignedTo || '-'}`);
    lines.push(`Created: ${mt.createdAt || '-'}`);
    if (mt.completedAt) lines.push(`Completed: ${mt.completedAt}`);

    let html = `<div style="margin-bottom:8px"><strong>Meta</strong><pre style="white-space:pre-wrap;background:var(--cream);padding:8px;border:1px solid var(--cyan)">${escapeHtml(lines.join('\n'))}</pre></div>`;

    // responses
    html += `<div><strong>Responses (${(mt.responses || []).length})</strong>`;
    if (!mt.responses || mt.responses.length === 0) {
        html += `<div style="margin-top:8px;color:gray">No responses yet.</div>`;
    } else {
        for (const r of mt.responses) {
            const rtime = r.at ? new Date(r.at).toLocaleString() : '-';
            let rtxt;
            try { rtxt = typeof r.result === 'object' ? JSON.stringify(r.result, null, 2) : String(r.result); }
            catch (e) { rtxt = String(r.result); }
            html += `<div style="margin-top:8px;padding:8px;border-left:4px solid var(--cyan);background:var(--cream)">
                 <div style="font-size:12px"><strong>${escapeHtml(r.deviceId || 'unknown')}</strong> — <span style="color:var(--purple);font-weight:700">${escapeHtml(rtime)}</span></div>
                 <pre style="white-space:pre-wrap;margin-top:6px">${escapeHtml(rtxt)}</pre>
               </div>`;
        }
    }
    html += `</div>`;

    // show in modal results area (reuse your modal resultBox area)
    const resultBox = document.getElementById('resultBox');
    resultBox.innerHTML = html;
}

/* Download single microtask result (JSON) */
function downloadMicrotaskResult(jobId, taskId) {
    const jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const job = jobs.find(j => j.id === jobId);
    if (!job) return alert('Job not found');
    const mt = job.microtasks.find(m => m.id === taskId);
    if (!mt) return alert('Microtask not found');

    const blob = new Blob([JSON.stringify(mt.result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${job.id}_${mt.id}_result.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/* Force rerun (mark pending) */
function forceRerunMicrotask(jobId, taskId) {
    if (!confirm('Force rerun this microtask (set to pending)?')) return;
    const jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const job = jobs.find(j => j.id === jobId);
    if (!job) return alert('Job not found');
    const mt = job.microtasks.find(m => m.id === taskId);
    if (!mt) return alert('Microtask not found');

    mt.status = 'pending';
    mt.assignedTo = null;
    mt.assignedAt = null;
    job.logs = job.logs || [];
    job.logs.push(`[${new Date().toISOString()}] Microtask ${taskId} forced to pending by requester`);

    const idx = jobs.findIndex(j => j.id === jobId); jobs[idx] = job;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
    // refresh UI
    renderMicrotasks(job);
    loadJobs();
    alert('Microtask set to pending — providers will pick it up.');
}

/* Rerun all failed microtasks in job */
function rerunFailed(jobId) {
    if (!confirm('Set all FAILED microtasks in this job to PENDING?')) return;
    const jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const job = jobs.find(j => j.id === jobId);
    if (!job) return alert('Job not found');
    let changed = 0;
    for (const mt of job.microtasks) {
        if (mt.status === 'failed') {
            mt.status = 'pending';
            mt.assignedTo = null;
            mt.assignedAt = null;
            changed++;
        }
    }
    job.logs = job.logs || [];
    job.logs.push(`[${new Date().toISOString()}] ${changed} failed microtasks requeued by requester`);
    const idx = jobs.findIndex(j => j.id === jobId); jobs[idx] = job;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
    renderMicrotasks(job);
    loadJobs();
    alert(`Requeued ${changed} microtask(s).`);
}

/* ============================
   Final result rendering & refresh
   ============================ */
function renderJobFinalResult(job) {
    const box = document.getElementById('resultBox');
    if (!box) return;
    box.innerHTML = '';

    if (job.status === 'completed' && job.finalResult) {
        // If matrix result exists, show in readable form + download button
        if (job.finalResult.matrixC) {
            const pre = document.createElement('pre');
            pre.textContent = JSON.stringify(job.finalResult.matrixC, null, 2);
            box.appendChild(pre);
        } else {
            const pre = document.createElement('pre');
            try { pre.textContent = JSON.stringify(job.finalResult, null, 2); }
            catch (e) { pre.textContent = String(job.finalResult); }
            box.appendChild(pre);
        }

        // Download button
        const dl = document.createElement('button');
        dl.className = 'btn-action';
        dl.style.marginTop = '8px';
        dl.textContent = 'Download Final Result';
        dl.onclick = () => {
            const blob = new Blob([JSON.stringify(job.finalResult, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `${job.id}_result.json`; a.click(); URL.revokeObjectURL(url);
        };
        box.appendChild(dl);
    } else {
        // not complete -> show progress summary
        const p = document.createElement('div');
        p.style.fontSize = '13px';
        p.style.color = 'gray';
        p.textContent = `Progress: ${job.completedMicrotasks || 0} / ${job.totalMicrotasks || job.estimatedMicrotasks || '-'} microtasks completed`;
        box.appendChild(p);
    }
}

/* Refresh modal content if it's open (useful for provider updates) */
function refreshModalIfOpen() {
    if (!currentPreviewJobId) return;
    const jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const job = jobs.find(j => j.id === currentPreviewJobId);
    if (!job) return;
    document.getElementById('modalTitle').innerText = job.title;
    document.getElementById('modalMeta').innerText = `${job.type} • ${job.totalMicrotasks || job.estimatedMicrotasks} microtasks • status ${job.status}`;
    // re-render
    renderMicrotasks(job);
    renderJobFinalResult(job);
    document.getElementById('logContainer').innerHTML = (job.logs || []).slice().reverse().map(l => `<div style="font-size:12px">${escapeHtml(l)}</div>`).join('');
}

/* Auto-refresh while modal open */
function startModalAutoRefresh() {
    stopModalAutoRefresh();
    modalRefreshTimer = setInterval(refreshModalIfOpen, 1200);
}
function stopModalAutoRefresh() {
    if (modalRefreshTimer) { clearInterval(modalRefreshTimer); modalRefreshTimer = null; }
}

/* ============================
   Edit / Delete / Download helpers
   ============================ */
function deleteJob(jobId) {
    if (!confirm('Delete this job permanently?')) return;
    let jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    jobs = jobs.filter(j => j.id !== jobId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
    loadJobs();
    if (currentPreviewJobId === jobId) closeModal();
}

function deleteCurrentJob() {
    if (!currentPreviewJobId) return;
    deleteJob(currentPreviewJobId);
    closeModal();
}

function downloadJob() {
    if (!currentPreviewJobId) return alert('No job selected to download.');

    const jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const job = jobs.find(j => j.id === currentPreviewJobId);
    if (!job) return alert('Job not found in storage.');

    // Try plain stringify first
    let jsonStr = null;
    try {
        jsonStr = JSON.stringify(job, null, 2);
    } catch (err) {
        console.warn('JSON.stringify failed on job — will attempt safe pruning:', err);
    }

    // Helper: detect objects we should skip
    function isBadValue(v) {
        if (v === null) return false;
        if (typeof v === 'function') return true;
        // CryptoKey detection
        if (typeof window !== 'undefined' && typeof window.CryptoKey !== 'undefined' && v instanceof window.CryptoKey) return true;
        // avoid DOM nodes, workers, ports, etc.
        if (typeof v === 'object') {
            const ctor = v && v.constructor && v.constructor.name;
            if (ctor === 'Window' || ctor === 'Document' || ctor === 'HTMLDocument' || ctor === 'Element' || ctor === 'Worker' || ctor === 'MessagePort') return true;
            // look for Node-like objects
            if (v && v.nodeType && v.nodeType === 1) return true;
        }
        return false;
    }

    // Recursive pruner: returns a serializable copy, skipping bad values
    function prune(value, depth = 0) {
        if (depth > 20) return '[maxDepth]';
        if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
        if (Array.isArray(value)) return value.map(v => prune(v, depth + 1));
        if (typeof value === 'object') {
            if (isBadValue(value)) return `[skipped:${value && value.constructor && value.constructor.name || typeof value}]`;
            const out = {};
            for (const k of Object.keys(value)) {
                try {
                    const v = value[k];
                    if (isBadValue(v)) {
                        out[k] = `[skipped:${v && v.constructor && v.constructor.name || typeof v}]`;
                        continue;
                    }
                    out[k] = prune(v, depth + 1);
                } catch (e) {
                    out[k] = `[error:${e && e.message || 'unknown'}]`;
                }
            }
            return out;
        }
        // other types (symbol, undefined) — represent simply
        return String(value);
    }

    if (jsonStr === null) {
        // fallback: prune job then stringify
        try {
            const safe = prune(job, 0);
            jsonStr = JSON.stringify(safe, null, 2);
        } catch (err) {
            console.error('Pruning + stringify also failed:', err);
            return alert('Unable to serialize job for download. Check console for details.');
        }
    }

    // Create blob and trigger download
    try {
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `${job.id}.json`;
        // append so click() works in all browsers
        document.body.appendChild(a);
        a.click();

        // cleanup
        setTimeout(() => {
            try { document.body.removeChild(a); } catch (e) { }
            try { URL.revokeObjectURL(url); } catch (e) { }
        }, 500);

    } catch (err) {
        console.error('Final download step failed:', err);
        alert('Download failed — check console for details.');
    }
}



/* Edit job: populate form for editing (simple replace) */
function editJob(jobId) {
    const jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const job = jobs.find(j => j.id === jobId);
    if (!job) return alert('Job not found');
    showJobForm();
    // populate fields
    document.getElementById('jobTitle').value = job.title;
    document.getElementById('jobDescription').value = job.description;
    document.getElementById('jobType').value = job.type;
    document.getElementById('chunkSize').value = job.chunkSize;
    document.getElementById('redundancy').value = job.redundancy;
    document.getElementById('priority').value = job.priority;
    document.getElementById('budget').value = job.budget || '';
    if (job.payload && job.payload.mode === 'text') {
        toggleInputMode('text');
        document.getElementById('inputData').value = job.payload.raw;
        stagedFile = null; setFileInfo('');
    } else if (job.payload && job.payload.mode === 'file') {
        toggleInputMode('file');
        stagedFile = job.payload.file; // re-use
        setFileInfo(`Loaded: ${stagedFile.name}`);
    } else if (job.payload && job.payload.mode === 'matrix') {
        toggleInputMode('text');
        // enable separate matrices UI and populate
        try {
            document.getElementById('separateMatricesToggle').checked = true;
            toggleSeparateMatrices();
            document.getElementById('matrixAInput').value = JSON.stringify(job.payload.A, null, 2);
            document.getElementById('matrixBInput').value = JSON.stringify(job.payload.B, null, 2);
        } catch (e) {
            document.getElementById('inputData').value = JSON.stringify({ A: job.payload.A, B: job.payload.B }, null, 2);
        }
        stagedFile = null; setFileInfo('');
    }

    // Remove old job and let user "Save Job" to create new version (simple approach)
    deleteJob(jobId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================
   Utils
   ============================ */
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

/* ============================
   Init
   ============================ */
document.addEventListener('DOMContentLoaded', () => {
    loadJobs();
    // attach simple handler to form to prevent accidental navigation
    window.addEventListener('beforeunload', (e) => {
        // no-op for now; keep simple
    });
});
