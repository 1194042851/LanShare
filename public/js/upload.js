import { api } from './api.js';

const CHUNK_SIZE = 4 * 1024 * 1024;
const CONCURRENCY = 3;
const MAX_RETRIES = 2;

const listeners = new Set();
const jobs = [];

export function onTransfer(fn) {
  listeners.add(fn);
}
function emit() {
  for (const fn of listeners) fn(jobs);
}

export function enqueue(files, dir) {
  const created = [];
  for (const file of files) {
    const job = {
      id: crypto.randomUUID(),
      file,
      dir,
      name: file.name,
      size: file.size,
      loaded: 0,
      state: 'queued',
      error: '',
      speed: 0,
      samples: [],
      uploadId: null,
      chunkSize: CHUNK_SIZE,
      controller: null,
      get progress() {
        return this.size === 0 ? 1 : Math.min(1, this.loaded / this.size);
      },
      get eta() {
        return this.speed > 0 ? ((this.size - this.loaded) / this.speed) * 1000 : 0;
      },
    };
    jobs.unshift(job);
    created.push(job);
    runJob(job);
  }
  if (jobs.length > 60) jobs.splice(60);
  emit();
  return created;
}

function track(job) {
  const now = performance.now();
  job.samples.push({ t: now, bytes: job.loaded });
  const cutoff = now - 3000;
  while (job.samples.length > 2 && job.samples[0].t < cutoff) job.samples.shift();
  const first = job.samples[0];
  const dt = (now - first.t) / 1000;
  if (dt > 0.4) job.speed = (job.loaded - first.bytes) / dt;
}

async function runJob(job) {
  try {
    if (job.state === 'canceled') return;
    job.state = 'uploading';
    emit();

    const init = await api.initUpload({
      dir: job.dir, name: job.name, size: job.size,
      chunkSize: CHUNK_SIZE, mtime: job.file.lastModified,
    });
    job.uploadId = init.uploadId;
    job.chunkSize = init.chunkSize;

    if (job.size === 0) {
      await api.completeUpload(job.uploadId);
      job.state = 'done';
      emit();
      return;
    }

    job.controller = new AbortController();
    const { signal } = job.controller;
    const total = init.totalChunks;
    let cursor = 0;

    const worker = async () => {
      while (cursor < total) {
        if (signal.aborted) return;
        const index = cursor++;
        await sendChunk(job, index, signal);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
    if (signal.aborted) return;

    await api.completeUpload(job.uploadId);
    job.loaded = job.size;
    job.state = 'done';
    job.speed = 0;
    emit();
  } catch (err) {
    if (err.name === 'AbortError') {
      job.state = 'canceled';
    } else {
      job.state = 'error';
      job.error = err.message || '上传失败';
    }
    emit();
  }
}

async function sendChunk(job, index, signal) {
  const start = index * job.chunkSize;
  const end = Math.min(start + job.chunkSize, job.size);
  const blob = job.file.slice(start, end);
  for (let attempt = 0; ; attempt++) {
    try {
      await api.uploadChunk(job.uploadId, index, blob, signal);
      job.loaded += end - start;
      track(job);
      emit();
      return;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (attempt >= MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

export function cancelJob(job) {
  job.controller?.abort();
  if (job.uploadId) api.cancelUpload(job.uploadId).catch(() => {});
  if (job.state !== 'done') job.state = 'canceled';
  emit();
}

export function clearFinished() {
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (['done', 'canceled', 'error'].includes(jobs[i].state)) jobs.splice(i, 1);
  }
  emit();
}

export function activeCount() {
  return jobs.filter((j) => j.state === 'uploading' || j.state === 'queued').length;
}
