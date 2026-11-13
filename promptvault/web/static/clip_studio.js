// =====================================================================
// PromptVault ◈ Klip Analiz Stüdyosu v3 & Visualizer Composer Köprüsü
// =====================================================================
(function() {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const cs = {
    songs: [],
    currentSong: null,
    audioUrl: null,
    fileName: '',
    duration: 0,
    sampleRate: 22050,
    bpm: 0,
    beatTimes: [],
    peakTimes: [],
    autoPeakTimes: [],
    sceneCuts: [],
    autoSceneCuts: [],
    blocks: [],
    avgEnergy: 0,
    bassPct: 0,
    midPct: 0,
    highPct: 0,
    dominantBand: '',
    // Spectrogram cache
    specFrames: 0,
    fftSize: 2048,
    hopSize: 512,
    effSr: 22050,
    magFrames: null,   // Float32Array[] or flat Float32Array (frames * bins)
    melMatrix: null,   // Float32Array (frames * 128) in dB [-80..0]
    linearDbMax: 0,
    // Raw frame energy curves for fast block recalculation
    timesArr: null,
    rmsNorm: null,
    bassNorm: null,
    midNorm: null,
    highNorm: null,
    centroidHz: null,
    vcReportText: '',
    vcGemPrompt: null,
    analyzing: false,
    rafId: null,
    // Plot geometry & interactive editing state
    plotRect: { x: 64, y: 24, w: 800, h: 320 },
    tool: 'move',
    dragCutIdx: -1,
    isDraggingCut: false,
    didDrag: false,
    // Animated spectrogram / WebM recording state
    recording: false,
    recorder: null,
    recordedChunks: [],
  };

  function toast(msg, isErr = false) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.style.borderColor = isErr ? 'var(--danger)' : 'var(--accent)';
    t.classList.remove('hidden');
    clearTimeout(toast._tm);
    toast._tm = setTimeout(() => t.classList.add('hidden'), 3200);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function secToMmss(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, '0')}:${rem.toFixed(2).padStart(5, '0')}`;
  }

  function secToTimecode(seconds, fps = 24) {
    fps = Math.max(1, parseInt(fps, 10) || 24);
    const total = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    let f = Math.round((total - Math.floor(total)) * fps);
    if (f >= fps) f = fps - 1;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      let errText = 'Hata oluştu';
      try {
        const d = await res.json();
        errText = d.detail || JSON.stringify(d);
      } catch {
        errText = await res.text();
      }
      throw new Error(errText);
    }
    return res.json();
  }

  // ===================================================================
  // COLORMAPS (Matplotlib-accurate 256-entry RGB LUTs)
  // ===================================================================
  const COLORMAP_STOPS = {
    magma: [
      [0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129],
      [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]
    ],
    inferno: [
      [0, 0, 4], [31, 12, 72], [85, 15, 109], [136, 34, 106],
      [186, 54, 85], [227, 89, 51], [249, 140, 10], [249, 201, 50], [252, 255, 164]
    ],
    viridis: [
      [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142],
      [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]
    ],
    plasma: [
      [13, 8, 135], [75, 3, 161], [125, 3, 168], [168, 34, 150],
      [203, 70, 121], [229, 107, 93], [248, 148, 65], [253, 195, 40], [240, 249, 33]
    ],
    coolwarm: [
      [59, 76, 192], [98, 130, 234], [141, 176, 254], [184, 208, 249],
      [221, 221, 221], [245, 196, 173], [244, 154, 123], [222, 96, 77], [180, 4, 38]
    ],
  };

  const LUT_CACHE = {};
  function getColormapLUT(name) {
    if (LUT_CACHE[name]) return LUT_CACHE[name];
    const stops = COLORMAP_STOPS[name] || COLORMAP_STOPS.magma;
    const lut = new Uint8ClampedArray(256 * 3);
    const segments = stops.length - 1;
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * segments;
      const idx = Math.min(segments - 1, Math.floor(t));
      const frac = t - idx;
      const c0 = stops[idx];
      const c1 = stops[idx + 1];
      lut[i * 3] = Math.round(c0[0] + (c1[0] - c0[0]) * frac);
      lut[i * 3 + 1] = Math.round(c0[1] + (c1[1] - c0[1]) * frac);
      lut[i * 3 + 2] = Math.round(c0[2] + (c1[2] - c0[2]) * frac);
    }
    LUT_CACHE[name] = lut;
    return lut;
  }

  // ===================================================================
  // RADIX-2 COOLEY-TUKEY FFT & DSP HELPERS
  // ===================================================================
  function createFFT(n) {
    const bitRev = new Uint32Array(n);
    const levels = Math.log2(n) | 0;
    for (let i = 0; i < n; i++) {
      let rev = 0;
      let x = i;
      for (let j = 0; j < levels; j++) {
        rev = (rev << 1) | (x & 1);
        x >>= 1;
      }
      bitRev[i] = rev;
    }
    const cosTable = new Float32Array(n / 2);
    const sinTable = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      const ang = (-2 * Math.PI * i) / n;
      cosTable[i] = Math.cos(ang);
      sinTable[i] = Math.sin(ang);
    }
    const hann = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    }
    return { n, bitRev, cosTable, sinTable, hann };
  }

  const FFT_2048 = createFFT(2048);

  function computeFrameSpectrum(fft, samples, startIdx, re, im, magOut) {
    const { n, bitRev, cosTable, sinTable, hann } = fft;
    for (let i = 0; i < n; i++) {
      const s = startIdx + i < samples.length ? samples[startIdx + i] : 0;
      const rIdx = bitRev[i];
      re[rIdx] = s * hann[i];
      im[rIdx] = 0;
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < half; j++) {
          const k = j * step;
          const tRe = re[i + j + half] * cosTable[k] - im[i + j + half] * sinTable[k];
          const tIm = re[i + j + half] * sinTable[k] + im[i + j + half] * cosTable[k];
          re[i + j + half] = re[i + j] - tRe;
          im[i + j + half] = im[i + j] - tIm;
          re[i + j] += tRe;
          im[i + j] += tIm;
        }
      }
    }
    const bins = n >> 1;
    for (let k = 0; k < bins; k++) {
      const r = re[k];
      const m = im[k];
      magOut[k] = Math.sqrt(r * r + m * m);
    }
  }

  function hzToMel(hz) {
    return 2595 * Math.log10(1 + hz / 700);
  }
  function melToHz(mel) {
    return 700 * (Math.pow(10, mel / 2595) - 1);
  }

  function buildMelFilterbank(nMels, fftSize, sr) {
    const bins = fftSize >> 1;
    const minMel = hzToMel(0);
    const maxMel = hzToMel(sr / 2);
    const melPts = new Float32Array(nMels + 2);
    for (let i = 0; i < nMels + 2; i++) {
      const m = minMel + ((maxMel - minMel) * i) / (nMels + 1);
      const hz = melToHz(m);
      melPts[i] = Math.floor(((fftSize + 1) * hz) / sr);
    }
    const filters = [];
    for (let m = 1; m <= nMels; m++) {
      const left = melPts[m - 1];
      const center = melPts[m];
      const right = melPts[m + 1];
      const entries = [];
      for (let k = Math.max(0, left); k <= Math.min(bins - 1, right); k++) {
        let w = 0;
        if (k >= left && k <= center && center > left) {
          w = (k - left) / (center - left);
        } else if (k > center && k <= right && right > center) {
          w = (right - k) / (right - center);
        }
        if (w > 0) entries.push([k, w]);
      }
      filters.push(entries);
    }
    return filters;
  }

  // Peak picking equivalent to librosa.util.peak_pick
  function peakPick(x, preMax, postMax, preAvg, postAvg, delta, wait) {
    const n = x.length;
    const peaks = [];
    let lastPeak = -wait - 1;
    for (let i = 1; i < n - 1; i++) {
      if (i - lastPeak <= wait) continue;
      const val = x[i];
      // Check local max in [i - preMax, i + postMax]
      let isMax = true;
      const a0 = Math.max(0, i - preMax);
      const a1 = Math.min(n - 1, i + postMax);
      for (let j = a0; j <= a1; j++) {
        if (x[j] > val) {
          isMax = false;
          break;
        }
      }
      if (!isMax) continue;
      // Check local mean + delta in [i - preAvg, i + postAvg]
      const b0 = Math.max(0, i - preAvg);
      const b1 = Math.min(n - 1, i + postAvg);
      let sum = 0;
      for (let j = b0; j <= b1; j++) sum += x[j];
      const avg = sum / (b1 - b0 + 1);
      if (val >= avg + delta) {
        peaks.push(i);
        lastPeak = i;
      }
    }
    return peaks;
  }

  // Estimate BPM via weighted autocorrelation on onset envelope
  function estimateBPM(onsetEnv, frameRate) {
    const n = onsetEnv.length;
    if (n < 32) return { bpm: 120.0, beats: [] };

    // Remove mean
    let mean = 0;
    for (let i = 0; i < n; i++) mean += onsetEnv[i];
    mean /= n;
    const centered = new Float32Array(n);
    for (let i = 0; i < n; i++) centered[i] = Math.max(0, onsetEnv[i] - mean);

    const minBpm = 58;
    const maxBpm = 182;
    let bestBpm = 120;
    let bestScore = -Infinity;

    // Evaluate candidate BPMs in 0.5 BPM steps
    for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
      const periodFrames = (60.0 / bpm) * frameRate;
      const lag = Math.round(periodFrames);
      if (lag < 2 || lag >= n / 2) continue;

      let ac1 = 0;
      let ac2 = 0;
      const limit = n - lag * 2;
      if (limit <= 10) continue;
      for (let i = 0; i < limit; i++) {
        ac1 += centered[i] * centered[i + lag];
        ac2 += centered[i] * centered[i + lag * 2];
      }
      // Log-normal tempo prior centered around 120 BPM (standard librosa prior)
      const logDiff = Math.log2(bpm / 120.0);
      const prior = Math.exp(-0.5 * (logDiff / 0.85) * (logDiff / 0.85));
      const score = (ac1 + 0.5 * ac2) * prior;
      if (score > bestScore) {
        bestScore = score;
        bestBpm = bpm;
      }
    }

    // Track beat phase
    const beatPeriod = 60.0 / bestBpm;
    const periodFrames = beatPeriod * frameRate;
    let bestPhase = 0;
    let bestPhaseScore = -Infinity;
    const steps = Math.max(1, Math.round(periodFrames));
    for (let ph = 0; ph < steps; ph++) {
      let sc = 0;
      for (let f = ph; f < n; f += periodFrames) {
        const idx = Math.round(f);
        if (idx < n) sc += centered[idx];
      }
      if (sc > bestPhaseScore) {
        bestPhaseScore = sc;
        bestPhase = ph;
      }
    }

    const beats = [];
    const totalDur = n / frameRate;
    for (let t = bestPhase / frameRate; t < totalDur; t += beatPeriod) {
      beats.push(Number(t.toFixed(3)));
    }
    return { bpm: Number(bestBpm.toFixed(1)), beats };
  }

  // ===================================================================
  // FULL AUDIO DECODE & ANALYSIS PIPELINE
  // ===================================================================
  async function analyzeAudioSource(arrayBuffer, displayName, songObj = null) {
    if (cs.analyzing) return;
    cs.analyzing = true;
    setStatus(`⏳ Çözümleniyor: ${displayName}...`, 'warn');
    setProgress(5);

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const audioBuf = await ctx.decodeAudioData(arrayBuffer.slice(0));
      try { await ctx.close(); } catch {}

      cs.currentSong = songObj;
      cs.fileName = displayName;
      cs.duration = audioBuf.duration;

      // Mix to mono
      const len = audioBuf.length;
      const nCh = audioBuf.numberOfChannels;
      const monoFull = new Float32Array(len);
      for (let ch = 0; ch < nCh; ch++) {
        const chData = audioBuf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          monoFull[i] += chData[i] / nCh;
        }
      }

      // Downsample to ~22050 Hz if higher
      const origSr = audioBuf.sampleRate;
      const stride = origSr > 24000 ? Math.max(2, Math.round(origSr / 22050)) : 1;
      const effSr = origSr / stride;
      const dsLen = Math.floor(len / stride);
      const samples = new Float32Array(dsLen);
      if (stride === 1) {
        samples.set(monoFull);
      } else {
        for (let i = 0; i < dsLen; i++) {
          let sum = 0;
          const base = i * stride;
          for (let j = 0; j < stride; j++) sum += monoFull[base + j];
          samples[i] = sum / stride;
        }
      }

      cs.effSr = effSr;
      const fftSize = 2048;
      const hopSize = 512;
      const bins = fftSize >> 1;
      const nFrames = Math.max(1, Math.floor((dsLen - fftSize) / hopSize) + 1);
      const frameRate = effSr / hopSize;
      cs.fftSize = fftSize;
      cs.hopSize = hopSize;
      cs.specFrames = nFrames;

      const binHz = effSr / fftSize;
      const bassStart = Math.max(1, Math.floor(20 / binHz));
      const bassEnd = Math.min(bins, Math.ceil(250 / binHz));
      const midStart = bassEnd;
      const midEnd = Math.min(bins, Math.ceil(4000 / binHz));
      const highStart = midEnd;
      const highEnd = bins;

      const nMels = 128;
      const melFilters = buildMelFilterbank(nMels, fftSize, effSr);

      const magFlat = new Float32Array(nFrames * bins);
      const melPower = new Float32Array(nFrames * nMels);
      const timesArr = new Float32Array(nFrames);
      const rmsRaw = new Float32Array(nFrames);
      const bassRaw = new Float32Array(nFrames);
      const midRaw = new Float32Array(nFrames);
      const highRaw = new Float32Array(nFrames);
      const centroidRaw = new Float32Array(nFrames);
      const onsetRaw = new Float32Array(nFrames);

      const re = new Float32Array(fftSize);
      const im = new Float32Array(fftSize);
      const magFrame = new Float32Array(bins);
      const prevLogMag = new Float32Array(bins);

      let maxMag = 1e-9;
      let maxMel = 1e-12;
      let maxRms = 1e-9;
      let maxBass = 1e-9;
      let maxMid = 1e-9;
      let maxHigh = 1e-9;

      const chunkSize = 350;
      for (let f = 0; f < nFrames; f++) {
        const startIdx = f * hopSize;
        timesArr[f] = startIdx / effSr;

        // Frame RMS
        let sq = 0;
        const endS = Math.min(dsLen, startIdx + fftSize);
        for (let i = startIdx; i < endS; i++) {
          const v = samples[i];
          sq += v * v;
        }
        const rms = Math.sqrt(sq / Math.max(1, endS - startIdx));
        rmsRaw[f] = rms;
        if (rms > maxRms) maxRms = rms;

        // FFT magnitude & spectral centroid
        computeFrameSpectrum(FFT_2048, samples, startIdx, re, im, magFrame);
        const offset = f * bins;
        let flux = 0;
        let freqWeightSum = 0;
        let magSum = 0;
        for (let k = 0; k < bins; k++) {
          const m = magFrame[k];
          magFlat[offset + k] = m;
          if (m > maxMag) maxMag = m;
          freqWeightSum += (k * binHz) * m;
          magSum += m;
          const lm = Math.log1p(m * 10);
          const diff = lm - prevLogMag[k];
          if (diff > 0) flux += diff;
          prevLogMag[k] = lm;
        }
        centroidRaw[f] = magSum > 1e-8 ? (freqWeightSum / magSum) : 0;
        onsetRaw[f] = flux;

        // Band means
        let bSum = 0;
        for (let k = bassStart; k < bassEnd; k++) bSum += magFrame[k];
        const bMean = bSum / Math.max(1, bassEnd - bassStart);
        bassRaw[f] = bMean;
        if (bMean > maxBass) maxBass = bMean;

        let mSum = 0;
        for (let k = midStart; k < midEnd; k++) mSum += magFrame[k];
        const mMean = mSum / Math.max(1, midEnd - midStart);
        midRaw[f] = mMean;
        if (mMean > maxMid) maxMid = mMean;

        let hSum = 0;
        for (let k = highStart; k < highEnd; k++) hSum += magFrame[k];
        const hMean = hSum / Math.max(1, highEnd - highStart);
        highRaw[f] = hMean;
        if (hMean > maxHigh) maxHigh = hMean;

        // Mel energies (power)
        const melOff = f * nMels;
        for (let m = 0; m < nMels; m++) {
          const entries = melFilters[m];
          let pwr = 0;
          for (let j = 0; j < entries.length; j++) {
            const [kIdx, w] = entries[j];
            const mg = magFrame[kIdx];
            pwr += (mg * mg) * w;
          }
          melPower[melOff + m] = pwr;
          if (pwr > maxMel) maxMel = pwr;
        }

        if (f % chunkSize === 0 && f > 0) {
          const pct = 10 + Math.round((f / nFrames) * 75);
          setProgress(pct);
          setStatus(`⏳ Spektrogram & FFT analiz ediliyor (%${pct})...`, 'warn');
          await new Promise(r => setTimeout(r, 0));
        }
      }

      setProgress(90);

      // Convert Mel power to dB [-80..0]
      const melDb = new Float32Array(nFrames * nMels);
      const refMel = Math.max(1e-12, maxMel);
      for (let i = 0; i < melPower.length; i++) {
        const db = 10 * Math.log10(Math.max(1e-10, melPower[i] / refMel));
        melDb[i] = Math.max(-80, Math.min(0, db));
      }

      // Normalize energy curves 0..100
      const rmsNorm = new Float32Array(nFrames);
      const bassNorm = new Float32Array(nFrames);
      const midNorm = new Float32Array(nFrames);
      const highNorm = new Float32Array(nFrames);
      for (let f = 0; f < nFrames; f++) {
        rmsNorm[f] = (rmsRaw[f] / (maxRms + 1e-9)) * 100;
        bassNorm[f] = (bassRaw[f] / (maxBass + 1e-9)) * 100;
        midNorm[f] = (midRaw[f] / (maxMid + 1e-9)) * 100;
        highNorm[f] = (highRaw[f] / (maxHigh + 1e-9)) * 100;
      }

      // Normalize onset envelope (z-score shifted positive)
      let oMean = 0;
      for (let f = 0; f < nFrames; f++) oMean += onsetRaw[f];
      oMean /= nFrames;
      let oVar = 0;
      for (let f = 0; f < nFrames; f++) {
        const d = onsetRaw[f] - oMean;
        oVar += d * d;
      }
      const oStd = Math.sqrt(oVar / nFrames) + 1e-6;
      const onsetZ = new Float32Array(nFrames);
      for (let f = 0; f < nFrames; f++) {
        onsetZ[f] = Math.max(0, (onsetRaw[f] - oMean) / oStd);
      }

      // Peak picking scaled to frameRate (librosa reference: 43.066 fps -> pre_max=20, pre_avg=50, wait=25)
      const scaleF = frameRate / 43.066;
      const preMax = Math.max(4, Math.round(20 * scaleF));
      const postMax = Math.max(4, Math.round(20 * scaleF));
      const preAvg = Math.max(10, Math.round(50 * scaleF));
      const postAvg = Math.max(10, Math.round(50 * scaleF));
      const wait = Math.max(8, Math.round(25 * scaleF));

      const peakFrames = peakPick(onsetZ, preMax, postMax, preAvg, postAvg, 1.35, wait);
      cs.peakTimes = peakFrames.map(idx => Number(timesArr[idx].toFixed(3)));
      cs.autoPeakTimes = [...cs.peakTimes];

      const tempoRes = estimateBPM(onsetZ, frameRate);
      cs.bpm = tempoRes.bpm;
      cs.beatTimes = tempoRes.beats;

      cs.magFrames = magFlat;
      cs.linearDbMax = maxMag;
      cs.melMatrix = melDb;
      cs.timesArr = timesArr;
      cs.rmsNorm = rmsNorm;
      cs.bassNorm = bassNorm;
      cs.midNorm = midNorm;
      cs.highNorm = highNorm;
      cs.centroidHz = centroidRaw;

      cs.autoSceneCuts = computeAutoSceneCuts(getBlockDuration(), getSegMode());
      cs.sceneCuts = [...cs.autoSceneCuts];

      recalculateBlocksAndReport();
      drawSpectrogram();
      drawAnimatedSpectrogram();
      enableControlsAfterAnalysis();
      setProgress(100);
      setTimeout(() => setProgress(0), 600);

      const step = getBlockDuration();
      const modeLbl = getSegMode() === 'snap' ? `Vuruş Kilitli (≤${step}sn)` : `${step}sn Sabit`;
      const totalClips = cs.blocks.length;
      setStatus(
        `✅ ${displayName} | Süre: ${cs.duration.toFixed(1)} sn (${secToMmss(cs.duration)}) | ` +
        `Tempo: ${cs.bpm.toFixed(1)} BPM | Toplam Blok: ${totalClips} (${modeLbl}) | Vuruş: ${cs.peakTimes.length}`,
        'ok'
      );
    } catch (err) {
      console.error('ClipStudio analysis error:', err);
      setStatus(`❌ Analiz hatası: ${err.message}`, 'err');
      toast('Ses analizi başarısız: ' + err.message, true);
      setProgress(0);
    } finally {
      cs.analyzing = false;
    }
  }

  // ===================================================================
  // 3-PHASE BLOCK SEGMENTATION & VISUALIZER COMPOSER REPORT
  // ===================================================================
  function getSegMode() {
    return $('#csSegMode')?.value || 'snap';
  }

  function getBlockDuration() {
    const val = $('#csSegmentSelect')?.value || '15';
    return Math.min(15, Math.max(3, parseInt(val, 10) || 15));
  }

  function getFps() {
    const val = $('#csFpsSelect')?.value || '24';
    return Math.max(1, parseInt(val, 10) || 24);
  }

  /**
   * Omni Flash kuralı: Her klip mutlaka [3.0, min(15.0, maxStep)] sn aralığında kalır.
   * 'snap' modunda kesim noktaları hedef süreye yakın en güçlü vuruşa/beat çizgisine kilitlenir.
   */
  function computeAutoSceneCuts(maxStep, mode = 'snap') {
    const dur = cs.duration || 0;
    const clampedMax = Math.min(15, Math.max(3, maxStep || 15));
    const minDur = 3.0;
    if (dur <= clampedMax + 0.05) return [];

    const cuts = [];
    if (mode === 'fixed') {
      for (let t = clampedMax; t < dur - 0.05; t += clampedMax) {
        cuts.push(Number(t.toFixed(2)));
      }
      if (cuts.length > 0 && dur - cuts[cuts.length - 1] < minDur) {
        const prev = cuts.length >= 2 ? cuts[cuts.length - 2] : 0;
        const shifted = Math.max(prev + minDur, Math.min(cuts[cuts.length - 1], dur - minDur));
        cuts[cuts.length - 1] = Number(shifted.toFixed(2));
      }
      return cuts;
    }

    // Beat-Snap modu: beatTimes + peakTimes adayları içinden en doğal müzikal sınırı seç
    const candidates = [];
    const seen = new Set();
    const pushCand = (t, weight) => {
      const key = Math.round(t * 20);
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ t, weight });
    };
    for (const p of (cs.peakTimes || [])) pushCand(p, 1.35);
    for (const b of (cs.beatTimes || [])) pushCand(b, 1.0);
    candidates.sort((a, b) => a.t - b.t);

    let cur = 0;
    let safety = 0;
    while (dur - cur > clampedMax + 0.05 && safety++ < 200) {
      const lo = cur + minDur;
      const hi = Math.min(cur + clampedMax, dur - minDur);
      if (hi < lo) break;

      const ideal = Math.min(hi, cur + Math.max(minDur + 1.0, clampedMax * 0.88));
      const prefMin = Math.max(lo, cur + clampedMax * 0.6);

      let bestT = null;
      let bestScore = -Infinity;
      for (const c of candidates) {
        if (c.t < lo || c.t > hi) continue;
        // Üst dilimdeki (ör. 9-14.5sn) vuruşlara öncelik ver
        const distPenalty = Math.abs(c.t - ideal) / Math.max(1, clampedMax);
        const zoneBonus = c.t >= prefMin ? 0.55 : 0;
        const score = c.weight + zoneBonus - distPenalty * 1.1;
        if (score > bestScore) {
          bestScore = score;
          bestT = c.t;
        }
      }

      if (bestT === null) {
        bestT = Math.min(hi, cur + clampedMax);
      }
      const rounded = Number(Math.max(lo, Math.min(hi, bestT)).toFixed(2));
      cuts.push(rounded);
      cur = rounded;
    }
    return cuts;
  }

  function getSceneBoundaries() {
    const dur = cs.duration || 0;
    if (dur <= 0) return [0, 0];
    const clean = [...(cs.sceneCuts || [])]
      .filter(t => Number.isFinite(t) && t > 0.5 && t < dur - 0.5)
      .sort((a, b) => a - b);
    const out = [0];
    for (const t of clean) {
      if (t - out[out.length - 1] >= 2.8 && dur - t >= 2.8) {
        out.push(Number(t.toFixed(2)));
      }
    }
    out.push(Number(dur.toFixed(2)));
    return out;
  }

  function parseSyncedLyricsLines(song) {
    const raw = song?.synced_lyrics || '';
    if (!raw.trim()) return [];
    const lines = [];
    let currentSection = '';
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const m = trimmed.match(/^\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
      if (m) {
        const sec = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
        const text = (m[3] || '').trim();
        if (/^\[[^\]]+\]$/.test(text)) {
          currentSection = text;
        }
        if (text) {
          lines.push({ time: Number(sec.toFixed(2)), text, section: currentSection });
        }
      } else if (/^\[[^\]]+\]$/.test(trimmed)) {
        currentSection = trimmed;
      }
    }
    return lines;
  }

  function getLightingFromCentroid(hz) {
    if (!hz || hz < 900) return 'Sıcak / Loş Sinematik (Tungsten, derin gölgeler, düşük anahtar ışık)';
    if (hz < 1800) return 'Doğal / Dengeli Kontrast (Altın saat veya nötr sinematik ışık)';
    if (hz < 3000) return 'Canlı / Soğuk-Parlak (Keskin rim-light, belirgin kenar ışığı)';
    return 'Yüksek Kontrast / Neon-Buz (Yoğun parıltı, kıvılcım ve sert ışık vurguları)';
  }

  function detectBlockDropTransition(times, rmsNorm, nFrames, start, end) {
    let minPre = 100;
    let dipTime = -1;
    let peakJump = 0;
    let dropAt = null;
    for (let f = 0; f < nFrames; f++) {
      const t = times[f];
      if (t < start || t >= end) continue;
      const val = rmsNorm[f];
      if (val < minPre) {
        minPre = val;
        dipTime = t;
      }
      if (dipTime >= 0 && t > dipTime && t - dipTime <= 2.2) {
        const jump = val - minPre;
        if (minPre < 34 && val >= 64 && jump >= 28 && jump > peakJump) {
          peakJump = jump;
          dropAt = Number((t - start).toFixed(1));
        }
      }
    }
    return dropAt !== null ? { hasDrop: true, relSec: dropAt } : { hasDrop: false, relSec: null };
  }

  function recalculateBlocksAndReport() {
    if (!cs.timesArr || !cs.rmsNorm) return;

    const maxStep = getBlockDuration();
    const segMode = getSegMode();
    if (cs.duration > maxStep + 0.05 && (!cs.sceneCuts || cs.sceneCuts.length === 0)) {
      cs.autoSceneCuts = computeAutoSceneCuts(maxStep, segMode);
      cs.sceneCuts = [...cs.autoSceneCuts];
    }

    const boundaries = getSceneBoundaries();
    const times = cs.timesArr;
    const rmsNorm = cs.rmsNorm;
    const bassNorm = cs.bassNorm;
    const midNorm = cs.midNorm;
    const highNorm = cs.highNorm;
    const centroidArr = cs.centroidHz;
    const nFrames = times.length;
    const syncedLines = ($('#csIncludeLyrics')?.checked ?? true) ? parseSyncedLyricsLines(cs.currentSong) : [];

    const blocks = [];
    const segmentsReport = [];
    let sceneIdx = 1;
    let prevEndEnergy = null;
    let prevDomFreq = null;

    let totalE = 0, totalB = 0, totalM = 0, totalH = 0;

    for (let bi = 0; bi < boundaries.length - 1; bi++) {
      const start = boundaries[bi];
      const end = boundaries[bi + 1];
      const rawLen = end - start;
      if (rawLen < 0.5) continue;
      const blockLen = Number(rawLen.toFixed(1));

      const third = rawLen / 3.0;
      let cnt = 0, sE = 0, sB = 0, sM = 0, sH = 0, sCent = 0;
      let c1 = 0, s1 = 0, c2 = 0, s2 = 0, c3 = 0, s3 = 0;

      for (let f = 0; f < nFrames; f++) {
        const t = times[f];
        if (t >= start && t <= end) {
          cnt++;
          sE += rmsNorm[f];
          sB += bassNorm[f];
          sM += midNorm[f];
          sH += highNorm[f];
          if (centroidArr) sCent += centroidArr[f];
          if (t < start + third) { c1++; s1 += rmsNorm[f]; }
          else if (t < start + 2 * third) { c2++; s2 += rmsNorm[f]; }
          else { c3++; s3 += rmsNorm[f]; }
        }
      }
      if (cnt === 0) continue;

      const eVal = sE / cnt;
      const bVal = sB / cnt;
      const mVal = sM / cnt;
      const hVal = sH / cnt;
      const centroidHzAvg = centroidArr ? Math.round(sCent / cnt) : 1500;
      const e1 = c1 > 0 ? s1 / c1 : eVal;
      const e2 = c2 > 0 ? s2 / c2 : eVal;
      const e3 = c3 > 0 ? s3 / c3 : eVal;

      totalE += eVal; totalB += bVal; totalM += mVal; totalH += hVal;

      let domFreq = 'Dengeli Enstrümantasyon';
      let nb2VisualHint = 'Dengeli ışık ve derinlik, sahne atmosferine uygun genel veya orta plan';
      if (bVal > mVal && bVal > 58) {
        domFreq = 'Dip Bas / Davul Baskın';
        nb2VisualHint = 'Derin gölgeler (chiaroscuro), ağır atmosfer, zemin/partikül gerilimi, güçlü kontrast';
      } else if (mVal > bVal && mVal > 58) {
        domFreq = 'Vokal / Gitar (Mid) Baskın';
        nb2VisualHint = 'Karakter/duygu veya enstrüman odağı, orta-yakın plan, sığ alan derinliği';
      } else if (hVal > 52) {
        domFreq = 'Tiz / Zil Baskın';
        nb2VisualHint = 'Keskin ışık huzmeleri (volumetric rays), parıltı/ateş/kıvılcım, yüksek kontrastlı aydınlatma';
      }

      const lightingHint = getLightingFromCentroid(centroidHzAvg);
      const dropInfo = detectBlockDropTransition(times, rmsNorm, nFrames, start, end);

      let isExtensionCandidate = false;
      if (prevEndEnergy !== null && Math.abs(e1 - prevEndEnergy) < 14 && eVal > 45 && domFreq === prevDomFreq && !dropInfo.hasDrop) {
        isExtensionCandidate = true;
      }
      prevEndEnergy = e3;
      prevDomFreq = domFreq;

      const sceneTypeStr = isExtensionCandidate
        ? '🔗 [UZATMA ADAYI - SCENE EXTENSION] -> Önceki sahnenin enerjisi kesintisiz devam ediyor! Önceki sahnenin devamı (Sahne X.1 - Scene Extension, Şablon 4) olarak planla (Yeni Nano Banana 2 görseli ÜRETİLMEZ).'
        : `🖼️ [ANA SAHNE ADAYI - Şablon 1 & 3] -> Nano Banana 2 Başlangıç Karesi (0s Enerji: %${e1.toFixed(0)}): ${nb2VisualHint} | Işık Tonu: ${lightingHint}`;

      const blockPeaks = cs.peakTimes
        .filter(p => p >= start && p < end)
        .map(p => ({ rel: Number((p - start).toFixed(1)), abs: Number(p.toFixed(2)) }));

      const peaksStr = blockPeaks.length > 0
        ? blockPeaks.map(p => `at +${p.rel.toFixed(1)}s (Genel: ${p.abs.toFixed(2)}s)`).join(', ')
        : 'Ani darbe yok (Akıcı ve kesintisiz kamera hareketi)';

      const matchedLyrics = syncedLines
        .filter(l => l.time >= start - 0.25 && l.time < end - 0.05)
        .map(l => ({
          rel: Number(Math.max(0, l.time - start).toFixed(1)),
          abs: l.time,
          text: l.text,
          section: l.section || '',
        }));

      let arcDesc = '🔄 Tutarlı Akış / Sabit Ritim';
      if (dropInfo.hasDrop) arcDesc = `🔥 Drop / Patlama (+${dropInfo.relSec}s)`;
      else if (e3 - e1 > 18) arcDesc = '📈 Yükselen Gerilim (Drop/Crescendo)';
      else if (e1 - e3 > 18) arcDesc = '📉 Sönümlenme (Decrescendo)';
      else if (e2 > e1 + 15 && e2 > e3 + 15) arcDesc = '⚡ Ortada Zirve';

      let timecodeGuide = '';
      if (blockLen > 7.5) {
        const t1End = Number(third.toFixed(1));
        const t2End = Number((2 * third).toFixed(1));
        timecodeGuide =
          `   • Omni Flash Zaman Kodu Rehberi (${arcDesc}):\n` +
          `     - [0-${t1End}s]  (1. Evre Enerji: %${e1.toFixed(0)}) -> Başlangıç kamerası ve ilk hareket\n` +
          `     - [${t1End}-${t2End}s] (2. Evre Enerji: %${e2.toFixed(0)}) -> Sahne içi aksiyon/atmosfer gelişimi\n` +
          `     - [${t2End}-${blockLen}s] (3. Evre Enerji: %${e3.toFixed(0)}) -> Final kamera kilidi veya momentum aktarımı\n`;
      } else {
        timecodeGuide = `   • Omni Flash Akışı (${blockLen}sn): Tek evreli akıcı kamera hareketi (Ortalama Enerji: %${eVal.toFixed(0)})\n`;
      }

      const audioDirective = (mVal > 62 && mVal > bVal)
        ? "Vokal/Performans ise 'expressive vocal performance...', atmosferik ise 'subtle ambient environmental sounds...'"
        : "'Audio: subtle ambient environmental sounds matching the scene only, silent background track, no dialogue, no music.'";

      const lyricsSummary = matchedLyrics.length > 0
        ? matchedLyrics.map(l => `[+${l.rel.toFixed(1)}s] ${l.text}`).join(' / ')
        : '';

      blocks.push({
        scene: sceneIdx,
        start,
        end,
        duration: blockLen,
        energy: Math.round(eVal),
        e1: Math.round(e1),
        e2: Math.round(e2),
        e3: Math.round(e3),
        bass: Math.round(bVal),
        mid: Math.round(mVal),
        high: Math.round(hVal),
        centroid_hz: centroidHzAvg,
        lighting_hint: lightingHint,
        has_drop_transition: dropInfo.hasDrop,
        drop_rel_sec: dropInfo.relSec,
        lyrics_lines: matchedLyrics,
        dominant_band: domFreq,
        visual_hint: nb2VisualHint,
        arc: arcDesc,
        is_extension_candidate: isExtensionCandidate,
        peaks: blockPeaks,
        audio_directive: audioDirective,
      });

      segmentsReport.push(
        `🎬 SAHNE ${String(sceneIdx).padStart(2, '0')} | [${secToMmss(start)} - ${secToMmss(end)}] (Süre: ${blockLen} sn | Omni Flash ≤15sn Uyumlu)\n` +
        `   • Akustik Özet : Ortalama Enerji: %${eVal.toFixed(0)} | Bas: %${bVal.toFixed(0)} | Vokal/Mid: %${mVal.toFixed(0)} | Tiz: %${hVal.toFixed(0)} (${domFreq})\n` +
        `   • Işık / Parlaklık: Spektral Merkez ${centroidHzAvg} Hz -> ${lightingHint}\n` +
        (dropInfo.hasDrop ? `   • 🔥 DROP TETİKLEYİCİ: Sahne içinde +${dropInfo.relSec}s noktasında sessizlikten patlamaya geçiş tespit edildi!\n` : '') +
        `   • Sahne Rolü   : ${sceneTypeStr}\n` +
        (lyricsSummary ? `   • Eşleşen Sözler: ${lyricsSummary}\n` : '') +
        `${timecodeGuide}` +
        `   • Klip İçi Vuruş Tepkileri (Single-Shot Trigger): ${peaksStr}\n` +
        `   • Önerilen Audio Direktifi: ${audioDirective}\n`
      );
      sceneIdx++;
    }

    cs.blocks = blocks;
    const nBlk = Math.max(1, blocks.length);
    cs.avgEnergy = Number((totalE / nBlk).toFixed(1));
    cs.bassPct = Number((totalB / nBlk).toFixed(1));
    cs.midPct = Number((totalM / nBlk).toFixed(1));
    cs.highPct = Number((totalH / nBlk).toFixed(1));

    if (cs.bassPct >= cs.midPct && cs.bassPct >= cs.highPct) cs.dominantBand = 'Dip Bas / Davul Baskın';
    else if (cs.midPct >= cs.bassPct && cs.midPct >= cs.highPct) cs.dominantBand = 'Vokal / Gitar (Mid) Baskın';
    else cs.dominantBand = 'Tiz / Zil Baskın';

    const allPeaksStr = cs.peakTimes.slice(0, 45).map(t => `${t.toFixed(2)}s (${secToMmss(t)})`).join(', ');
    const beatInterval = cs.bpm > 0 ? (60.0 / cs.bpm) : 0.5;
    const modeDesc = segMode === 'snap'
      ? `Vuruşa Kilitli Akıllı Bölümleme (Maks ${maxStep}sn · Omni Flash ≤15sn Garantili — Toplam ${blocks.length} Sahne)`
      : `${maxStep} Saniyelik Sabit Omni Flash Sekansları (Toplam ${blocks.length} Sahne)`;

    let songContextBlock = '';
    const includeMeta = $('#csIncludeLyrics')?.checked;
    if (includeMeta && cs.currentSong) {
      const s = cs.currentSong;
      songContextBlock =
        `\n----------------------------------------------------------------------\n` +
        `🎵 PROMPTVAULT ŞARKI METADATA, STİL & SÖZLER\n` +
        `----------------------------------------------------------------------\n` +
        `Şarkı Adı   : ${s.title || cs.fileName}\n` +
        (s.artist ? `Sanatçı     : ${s.artist}\n` : '') +
        (s.persona ? `Suno Persona: ${s.persona}\n` : '') +
        (s.style ? `\n[TAM STİL / PROMPT]\n${s.style}\n` : '') +
        (s.lyrics ? `\n[ŞARKI SÖZLERİ & META ETİKETLER]\n${s.lyrics}\n` : '');
    }

    cs.vcReportText =
      `======================================================================\n` +
      `🎬 KLİP ANALİZ STÜDYOSU - VISUALIZER COMPOSER VERİ PAKETİ\n` +
      `======================================================================\n` +
      `Dosya Adı        : ${cs.fileName}\n` +
      `Toplam Süre      : ${cs.duration.toFixed(2)} saniye (${secToMmss(cs.duration)}) [±5 sn Tolerans Kilitli]\n` +
      `Tempo (BPM)      : ${cs.bpm.toFixed(1)} BPM (1 Vuruş Aralığı: ${beatInterval.toFixed(2)} sn)\n` +
      `Planlanan Bloklar: ${modeDesc}\n\n` +
      `----------------------------------------------------------------------\n` +
      `⚡ TÜM ŞARKIDAKİ AKUSTİK PATLAMA / TETİKLEYİCİ NOKTALARI (GENEL ZAMAN)\n` +
      `----------------------------------------------------------------------\n` +
      `${allPeaksStr || 'Tespit edilen ani vuruş yok'}\n\n` +
      `----------------------------------------------------------------------\n` +
      `🎞️ ZAMAN KODLU MÜZİKAL OLAY HARİTASI (NANO BANANA 2 & OMNI FLASH UYUMLU)\n` +
      `----------------------------------------------------------------------\n` +
      `${segmentsReport.join('\n')}` +
      `${songContextBlock}\n` +
      `======================================================================\n` +
      `💡 VISUALIZER COMPOSER İÇİN NOT:\n` +
      `Yukarıdaki 'KLİP ANALİZ STÜDYOSU' verisi ve ekteki Spektrogram PNG'si şarkının tam süresini, BPM'ini, ` +
      `spektral parlaklık (ışık) önerisini, Drop geçişlerini, 3 evreli enerji eğrisini ve 'at +X.Xs' klip içi vuruş noktalarını içermektedir. ` +
      `Tüm sahneler ≤15 saniye Omni Flash sınırına göre planlanmıştır. Lütfen modu doğrudan 'Klip' olarak kilitle, ` +
      `4. adımdaki süre sorusunu atla ve 2. adımdan (Görsel Stil Tespiti) başlayarak iş akışını yürüt.\n`;

    const vcTxt = $('#csVcReport');
    if (vcTxt) vcTxt.value = cs.vcReportText;

    renderMetricsStrip();
    renderSceneCards();
  }

  // ===================================================================
  // SPECTROGRAM CANVAS RENDERING (LIVE + HIGH-RES PNG EXPORT)
  // ===================================================================
  function renderSpectrogramToCanvas(canvas, width, height, playheadSec = null) {
    if (!canvas || !cs.melMatrix || !cs.magFrames) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    const padL = Math.round(width * 0.062);
    const padR = Math.round(width * 0.082);
    const padT = Math.round(height * 0.095);
    const padB = Math.round(height * 0.115);
    const plotW = Math.max(100, width - padL - padR);
    const plotH = Math.max(80, height - padT - padB);
    cs.plotRect = { x: padL, y: padT, w: plotW, h: plotH };

    const scale = $('#csScaleSelect')?.value || 'mel';
    const cmap = $('#csCmapSelect')?.value || 'magma';
    const showPeaks = $('#csShowPeaks')?.checked ?? true;
    const showGrid = $('#csShowGrid')?.checked ?? true;
    const step = getBlockDuration();
    const lut = getColormapLUT(cmap);

    const nFrames = cs.specFrames;
    const bins = cs.fftSize >> 1;
    const nyquist = cs.effSr / 2;

    // Draw spectrogram pixels via ImageData
    const imgData = ctx.createImageData(plotW, plotH);
    const pixels = imgData.data;

    // Precompute y -> source row/bin mapping
    const yMap = new Int32Array(plotH);
    if (scale === 'mel') {
      const nMels = 128;
      for (let py = 0; py < plotH; py++) {
        const frac = 1 - py / Math.max(1, plotH - 1);
        yMap[py] = Math.min(nMels - 1, Math.max(0, Math.round(frac * (nMels - 1))));
      }
    } else if (scale === 'log') {
      const minHz = 20;
      const logMin = Math.log10(minHz);
      const logMax = Math.log10(nyquist);
      for (let py = 0; py < plotH; py++) {
        const frac = 1 - py / Math.max(1, plotH - 1);
        const hz = Math.pow(10, logMin + frac * (logMax - logMin));
        const b = Math.round((hz / nyquist) * (bins - 1));
        yMap[py] = Math.min(bins - 1, Math.max(0, b));
      }
    } else {
      for (let py = 0; py < plotH; py++) {
        const frac = 1 - py / Math.max(1, plotH - 1);
        yMap[py] = Math.min(bins - 1, Math.max(0, Math.round(frac * (bins - 1))));
      }
    }

    const refMag = Math.max(1e-9, cs.linearDbMax);
    for (let px = 0; px < plotW; px++) {
      const fIdx = Math.min(nFrames - 1, Math.floor((px / plotW) * nFrames));
      if (scale === 'mel') {
        const base = fIdx * 128;
        for (let py = 0; py < plotH; py++) {
          const db = cs.melMatrix[base + yMap[py]]; // [-80..0]
          const cIdx = Math.min(255, Math.max(0, Math.round(((db + 80) / 80) * 255))) * 3;
          const p = (py * plotW + px) * 4;
          pixels[p] = lut[cIdx];
          pixels[p + 1] = lut[cIdx + 1];
          pixels[p + 2] = lut[cIdx + 2];
          pixels[p + 3] = 255;
        }
      } else {
        const base = fIdx * bins;
        for (let py = 0; py < plotH; py++) {
          const mg = cs.magFrames[base + yMap[py]];
          const db = Math.max(-80, Math.min(0, 20 * Math.log10(Math.max(1e-10, mg / refMag))));
          const cIdx = Math.min(255, Math.max(0, Math.round(((db + 80) / 80) * 255))) * 3;
          const p = (py * plotW + px) * 4;
          pixels[p] = lut[cIdx];
          pixels[p + 1] = lut[cIdx + 1];
          pixels[p + 2] = lut[cIdx + 2];
          pixels[p + 3] = 255;
        }
      }
    }
    ctx.putImageData(imgData, padL, padT);

    // Plot border
    ctx.strokeStyle = '#555555';
    ctx.lineWidth = Math.max(1, width / 1000);
    ctx.strokeRect(padL, padT, plotW, plotH);

    // Yellow Omni Flash block lines (interactive scene boundaries)
    const fontScale = Math.max(1, width / 1100);
    const boundaries = getSceneBoundaries();
    if (showGrid && cs.duration > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(252, 196, 25, 0.9)';
      ctx.lineWidth = Math.max(1.5, 1.8 * fontScale);
      ctx.font = `bold ${Math.round(10 * fontScale)}px Consolas, monospace`;
      ctx.fillStyle = '#fcc419';
      for (let bi = 0; bi < boundaries.length - 1; bi++) {
        const sec = boundaries[bi];
        const x = padL + (sec / cs.duration) * plotW;
        if (bi > 0) {
          ctx.beginPath();
          ctx.moveTo(x, padT);
          ctx.lineTo(x, padT + plotH);
          ctx.stroke();
          // Drag handle triangle at top & bottom (live view)
          if (playheadSec !== null) {
            ctx.beginPath();
            ctx.moveTo(x - 5 * fontScale, padT);
            ctx.lineTo(x + 5 * fontScale, padT);
            ctx.lineTo(x, padT + 8 * fontScale);
            ctx.closePath();
            ctx.fill();
          }
        }
        if (x + 28 * fontScale < padL + plotW) {
          ctx.fillText(`S${String(bi + 1).padStart(2, '0')}`, x + 4 * fontScale, padT + 14 * fontScale);
        }
      }
      ctx.restore();
    }

    // Cyan dashed acoustic peak lines
    if (showPeaks && cs.peakTimes.length > 0 && cs.duration > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 245, 212, 0.62)';
      ctx.lineWidth = Math.max(1, 1.0 * fontScale);
      ctx.setLineDash([5 * fontScale, 4 * fontScale]);
      for (const pt of cs.peakTimes) {
        const x = padL + (pt / cs.duration) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Playhead (live view only)
    if (playheadSec !== null && cs.duration > 0 && playheadSec >= 0 && playheadSec <= cs.duration) {
      const px = padL + (playheadSec / cs.duration) * plotW;
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, padT);
      ctx.lineTo(px, padT + plotH);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px, padT + 4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(13 * fontScale)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    const segTitle = getSegMode() === 'snap' ? `Vuruş Kilitli ≤${step}sn` : `${step}sn Sabit`;
    ctx.fillText(
      `${cs.fileName} | ${cs.bpm.toFixed(1)} BPM | Sarı: ${cs.blocks.length || boundaries.length - 1} Sahne (${segTitle}) | Turkuaz: Vuruş (${cs.peakTimes.length})`,
      padL + plotW / 2,
      Math.round(padT * 0.62)
    );

    // Y-axis ticks & labels (Hz)
    ctx.fillStyle = '#d1d5db';
    ctx.font = `${Math.round(10.5 * fontScale)}px Consolas, monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const yTicks = scale === 'mel'
      ? [0, 512, 1024, 2048, 4096, 8192]
      : (scale === 'log' ? [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192] : [0, 2000, 4000, 6000, 8000, 10000]);
    for (const hz of yTicks) {
      if (hz > nyquist) continue;
      let frac = 0;
      if (scale === 'mel') {
        frac = hzToMel(hz) / hzToMel(nyquist);
      } else if (scale === 'log') {
        if (hz < 20) continue;
        frac = (Math.log10(hz) - Math.log10(20)) / (Math.log10(nyquist) - Math.log10(20));
      } else {
        frac = hz / nyquist;
      }
      const py = padT + plotH * (1 - frac);
      ctx.fillText(`${hz >= 1000 ? (hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1) + 'k' : hz}`, padL - 8 * fontScale, py);
    }

    // X-axis ticks (MM:SS)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const tickInterval = cs.duration > 240 ? 30 : (cs.duration > 90 ? 15 : 10);
    for (let t = 0; t <= cs.duration; t += tickInterval) {
      const px = padL + (t / Math.max(0.1, cs.duration)) * plotW;
      const mm = Math.floor(t / 60);
      const ss = Math.floor(t % 60);
      ctx.fillText(`${mm}:${String(ss).padStart(2, '0')}`, px, padT + plotH + 7 * fontScale);
    }
    ctx.fillStyle = '#9ca3af';
    ctx.font = `${Math.round(11 * fontScale)}px system-ui, sans-serif`;
    ctx.fillText('Zaman (Dakika:Saniye) — Tıklayarak Şarkıda Atlayabilirsiniz', padL + plotW / 2, padT + plotH + 26 * fontScale);

    // Colorbar on right
    const cbX = padL + plotW + Math.round(14 * fontScale);
    const cbW = Math.round(14 * fontScale);
    for (let y = 0; y < plotH; y++) {
      const norm = 1 - y / Math.max(1, plotH - 1);
      const cIdx = Math.min(255, Math.max(0, Math.round(norm * 255))) * 3;
      ctx.fillStyle = `rgb(${lut[cIdx]},${lut[cIdx + 1]},${lut[cIdx + 2]})`;
      ctx.fillRect(cbX, padT + y, cbW, 1);
    }
    ctx.strokeStyle = '#555555';
    ctx.strokeRect(cbX, padT, cbW, plotH);
    ctx.fillStyle = '#d1d5db';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(10 * fontScale)}px Consolas, monospace`;
    for (const dbVal of [0, -20, -40, -60, -80]) {
      const frac = (dbVal + 80) / 80;
      const py = padT + plotH * (1 - frac);
      ctx.fillText(`${dbVal} dB`, cbX + cbW + 5 * fontScale, py);
    }
  }

  function drawSpectrogram() {
    const canvas = $('#csSpecCanvas');
    if (!canvas || !cs.melMatrix) return;
    if ($('#csGridWrap')?.classList.contains('hidden')) return;
    const container = canvas.parentElement;
    const w = Math.max(760, Math.min(1600, container?.clientWidth || 1080));
    const h = 390;
    const audio = $('#csAudio');
    const playhead = audio && !audio.paused && audio.duration ? audio.currentTime : (audio?.currentTime || 0);
    renderSpectrogramToCanvas(canvas, w, h, playhead);
  }

  function drawAnimatedSpectrogram() {
    const canvas = $('#csAnimCanvas');
    if (!canvas || !cs.melMatrix || !cs.timesArr) return;
    const animWrap = $('#csAnimWrap');
    if (animWrap?.classList.contains('hidden')) return;

    const w = Math.max(640, Math.min(1280, (animWrap?.clientWidth || 1020) - 4));
    const h = 250;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0d0f17';
    ctx.fillRect(0, 0, w, h);

    const audio = $('#csAudio');
    const curTime = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const cmap = $('#csCmapSelect')?.value || 'magma';
    const lut = getColormapLUT(cmap);
    const nFrames = cs.specFrames;
    const nMels = 128;
    const frameRate = cs.effSr / cs.hopSize;

    // Sol panel (%63): Akan ±5sn Canlı Spektrogram Şelalesi
    const wfX = 12;
    const wfY = 38;
    const wfW = Math.round(w * 0.62);
    const wfH = h - 76;
    const windowHalf = 5.0; // ±5 saniye

    const imgData = ctx.createImageData(wfW, wfH);
    const pixels = imgData.data;
    const yToMel = new Int32Array(wfH);
    for (let py = 0; py < wfH; py++) {
      yToMel[py] = Math.min(nMels - 1, Math.max(0, Math.round((1 - py / Math.max(1, wfH - 1)) * (nMels - 1))));
    }

    for (let px = 0; px < wfW; px++) {
      const t = curTime + ((px / Math.max(1, wfW - 1)) - 0.5) * (windowHalf * 2);
      if (t < 0 || t > cs.duration) {
        for (let py = 0; py < wfH; py++) {
          const p = (py * wfW + px) * 4;
          pixels[p] = 16; pixels[p + 1] = 18; pixels[p + 2] = 28; pixels[p + 3] = 255;
        }
        continue;
      }
      const fIdx = Math.min(nFrames - 1, Math.max(0, Math.round(t * frameRate)));
      const base = fIdx * nMels;
      for (let py = 0; py < wfH; py++) {
        const db = cs.melMatrix[base + yToMel[py]];
        const cIdx = Math.min(255, Math.max(0, Math.round(((db + 80) / 80) * 255))) * 3;
        const p = (py * wfW + px) * 4;
        pixels[p] = lut[cIdx];
        pixels[p + 1] = lut[cIdx + 1];
        pixels[p + 2] = lut[cIdx + 2];
        pixels[p + 3] = 255;
      }
    }
    ctx.putImageData(imgData, wfX, wfY);
    ctx.strokeStyle = '#334155';
    ctx.strokeRect(wfX, wfY, wfW, wfH);

    // Akan pencerede yaklaşan sahne sınırları ve vuruşlar
    const tMin = curTime - windowHalf;
    const tMax = curTime + windowHalf;
    ctx.save();
    for (const pt of cs.peakTimes) {
      if (pt < tMin || pt > tMax) continue;
      const x = wfX + ((pt - tMin) / (windowHalf * 2)) * wfW;
      ctx.strokeStyle = 'rgba(0, 245, 212, 0.72)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, wfY); ctx.lineTo(x, wfY + wfH); ctx.stroke();
    }
    ctx.setLineDash([]);
    const boundaries = getSceneBoundaries();
    for (let bi = 1; bi < boundaries.length - 1; bi++) {
      const bt = boundaries[bi];
      if (bt < tMin || bt > tMax) continue;
      const x = wfX + ((bt - tMin) / (windowHalf * 2)) * wfW;
      ctx.strokeStyle = '#fcc419';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, wfY); ctx.lineTo(x, wfY + wfH); ctx.stroke();
      ctx.fillStyle = '#fcc419';
      ctx.font = 'bold 10px Consolas, monospace';
      ctx.fillText(`S${String(bi + 1).padStart(2, '0')}`, x + 3, wfY + 12);
    }

    // Merkez NOW Playhead çizgisi
    const centerX = wfX + wfW / 2;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(centerX, wfY - 4); ctx.lineTo(centerX, wfY + wfH + 4); ctx.stroke();
    ctx.restore();

    // Sağ panel (%35): Canlı 48-Bant Spektrum Çubukları + Bas/Mid/Tiz + Vuruş Halkası
    const spX = wfX + wfW + 18;
    const spY = wfY;
    const spW = Math.max(160, w - spX - 14);
    const spH = wfH;
    ctx.fillStyle = '#131722';
    ctx.fillRect(spX, spY, spW, spH);
    ctx.strokeStyle = '#334155';
    ctx.strokeRect(spX, spY, spW, spH);

    const curFrame = Math.min(nFrames - 1, Math.max(0, Math.round(curTime * frameRate)));
    const barCount = 48;
    const barGap = 2;
    const barW = Math.max(2, (spW - 16 - barGap * (barCount - 1)) / barCount);
    const curMelBase = curFrame * nMels;

    // Yakın vuruş parlaması
    let beatPulse = 0;
    for (const pt of cs.peakTimes) {
      const dt = curTime - pt;
      if (dt >= -0.04 && dt <= 0.22) {
        beatPulse = Math.max(beatPulse, 1 - Math.abs(dt) / 0.22);
      }
    }

    for (let b = 0; b < barCount; b++) {
      const melIdx = Math.min(nMels - 1, Math.floor((b / barCount) * (nMels * 0.85)));
      const db = cs.melMatrix[curMelBase + melIdx];
      const norm = Math.min(1, Math.max(0.03, (db + 75) / 75));
      const bh = Math.round(norm * (spH - 34));
      const bx = spX + 8 + b * (barW + barGap);
      const by = spY + spH - 24 - bh;
      const cIdx = Math.min(255, Math.max(0, Math.round(norm * 255))) * 3;
      ctx.fillStyle = `rgb(${lut[cIdx]},${lut[cIdx + 1]},${lut[cIdx + 2]})`;
      ctx.fillRect(bx, by, barW, bh);
    }

    // Canlı Bas / Mid / Tiz küçük barları
    const curB = cs.bassNorm ? cs.bassNorm[curFrame] : 0;
    const curM = cs.midNorm ? cs.midNorm[curFrame] : 0;
    const curH = cs.highNorm ? cs.highNorm[curFrame] : 0;
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`BAS %${Math.round(curB)}  MID %${Math.round(curM)}  TIZ %${Math.round(curH)}`, spX + 8, spY + spH - 8);

    // Beat pulse göstergesi
    if (beatPulse > 0.05) {
      ctx.save();
      ctx.fillStyle = `rgba(0, 245, 212, ${(beatPulse * 0.85).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(spX + spW - 18, spY + 18, 5 + beatPulse * 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Üst & Alt HUD: Aktif Sahne + 15sn İlerleme + Eşleşen Söz
    const activeBlock = (cs.blocks || []).find(bl => curTime >= bl.start && curTime <= bl.end) || cs.blocks?.[0];
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    const topText = activeBlock
      ? `▶ SAHNE ${String(activeBlock.scene).padStart(2, '0')} (${activeBlock.duration}sn) · ${activeBlock.arc} · ${secToMmss(curTime)} / ${secToMmss(cs.duration)}`
      : `▶ ${secToMmss(curTime)} / ${secToMmss(cs.duration)}`;
    ctx.fillText(topText, wfX, 23);

    // Alt söz şeridi
    let activeLyric = '';
    if (activeBlock?.lyrics_lines?.length) {
      const pastLines = activeBlock.lyrics_lines.filter(l => l.abs <= curTime + 0.3);
      activeLyric = (pastLines.length ? pastLines[pastLines.length - 1] : activeBlock.lyrics_lines[0]).text;
    }
    ctx.fillStyle = activeLyric ? '#fde047' : '#94a3b8';
    ctx.font = '11.5px system-ui, sans-serif';
    ctx.fillText(
      activeLyric ? `🎤 ${activeLyric}` : `⚡ ${cs.bpm.toFixed(1)} BPM · Akan ±5sn Spektrogram & Canlı Frekans Tepkisi`,
      wfX,
      h - 14
    );
  }

  function startPlayheadLoop() {
    cancelAnimationFrame(cs.rafId);
    const audio = $('#csAudio');
    const stepFrame = () => {
      if (!audio || (audio.paused && !cs.recording) || audio.ended) return;
      drawSpectrogram();
      drawAnimatedSpectrogram();
      cs.rafId = requestAnimationFrame(stepFrame);
    };
    cs.rafId = requestAnimationFrame(stepFrame);
  }

  function toggleRecordWebm() {
    const btn = $('#csBtnRecordWebm');
    const animCanvas = $('#csAnimCanvas');
    const audio = $('#csAudio');
    if (cs.recording && cs.recorder) {
      cs.recorder.stop();
      return;
    }
    if (!animCanvas || !cs.melMatrix) {
      toast('Önce bir şarkıyı analiz edin.', true);
      return;
    }
    // Canlı animasyon panelini görünür kıl
    if ($('#csViewMode')?.value === 'grid') {
      $('#csViewMode').value = 'both';
      $('#csAnimWrap')?.classList.remove('hidden');
      drawAnimatedSpectrogram();
    }
    if (typeof animCanvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      toast('Tarayıcınız MediaRecorder / Canvas video kaydını desteklemiyor.', true);
      return;
    }

    try {
      const stream = animCanvas.captureStream(30);
      // Tarayıcı izin veriyorsa ses akışını da ekle
      const audioStream = audio && (audio.captureStream ? audio.captureStream() : (audio.mozCaptureStream ? audio.mozCaptureStream() : null));
      if (audioStream) {
        audioStream.getAudioTracks().forEach(t => stream.addTrack(t));
      }
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_500_000 });
      cs.recordedChunks = [];
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) cs.recordedChunks.push(ev.data);
      };
      rec.onstop = () => {
        cs.recording = false;
        cs.recorder = null;
        if (btn) {
          btn.textContent = '🎥 Animasyon Kaydet (.webm)';
          btn.classList.remove('recording');
        }
        const blob = new Blob(cs.recordedChunks, { type: 'video/webm' });
        const a = document.createElement('a');
        const base = (cs.fileName || 'music').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
        a.href = URL.createObjectURL(blob);
        a.download = `${base}_animated_spectrogram.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        toast('🎥 Animasyonlu Spektrogram WebM videosu indirildi!');
      };
      rec.start(250);
      cs.recorder = rec;
      cs.recording = true;
      if (btn) {
        btn.textContent = '⏹️ Kaydı Durdur & İndir';
        btn.classList.add('recording');
      }
      if (audio && audio.src && audio.paused) {
        audio.play().catch(() => {});
      }
      startPlayheadLoop();
      toast('🔴 Canlı Animasyonlu Spektrogram kaydı başladı...');
    } catch (e) {
      toast('WebM kayıt başlatılamadı: ' + e.message, true);
    }
  }

  // ===================================================================
  // UI RENDERING HELPERS
  // ===================================================================
  function setStatus(text, tone = 'muted') {
    const el = $('#csStatus');
    if (!el) return;
    el.textContent = text;
    el.className = `cs-status cs-status-${tone}`;
  }

  function setProgress(pct) {
    const bar = $('#csProgressFill');
    const wrap = $('#csProgressWrap');
    if (!bar || !wrap) return;
    if (pct <= 0) {
      wrap.classList.add('hidden');
      bar.style.width = '0%';
    } else {
      wrap.classList.remove('hidden');
      bar.style.width = `${Math.min(100, pct)}%`;
    }
  }

  function enableControlsAfterAnalysis() {
    ['#csBtnSavePng', '#csBtnCopyVc', '#csBtnPremiere', '#csBtnRecordWebm'].forEach(sel => {
      const b = $(sel);
      if (b) b.disabled = false;
    });
    const saveDbBtn = $('#csBtnSaveDb');
    if (saveDbBtn) {
      saveDbBtn.disabled = !cs.currentSong;
      saveDbBtn.classList.toggle('hidden', !cs.currentSong);
    }
  }

  function renderMetricsStrip() {
    const strip = $('#csMetricsStrip');
    if (!strip) return;
    const step = getBlockDuration();
    const beatInt = cs.bpm > 0 ? (60 / cs.bpm).toFixed(2) : '0.50';
    const segLabel = getSegMode() === 'snap' ? `≤${step}sn Vuruş Kilitli` : `${step}sn Sabit`;
    strip.classList.remove('hidden');
    strip.innerHTML = `
      <div class="cs-metric-card">
        <span class="cs-metric-lbl">⏱️ Toplam Süre</span>
        <strong class="cs-metric-val">${secToMmss(cs.duration)}</strong>
        <span class="cs-metric-sub">${cs.duration.toFixed(2)} sn</span>
      </div>
      <div class="cs-metric-card">
        <span class="cs-metric-lbl">🥁 Tempo (BPM)</span>
        <strong class="cs-metric-val">${cs.bpm.toFixed(1)} BPM</strong>
        <span class="cs-metric-sub">1 Vuruş: ${beatInt} sn</span>
      </div>
      <div class="cs-metric-card">
        <span class="cs-metric-lbl">🎞️ Omni Flash Blokları</span>
        <strong class="cs-metric-val">${cs.blocks.length} Sahne</strong>
        <span class="cs-metric-sub">${segLabel}</span>
      </div>
      <div class="cs-metric-card">
        <span class="cs-metric-lbl">⚡ Akustik Vuruş</span>
        <strong class="cs-metric-val">${cs.peakTimes.length} Nokta</strong>
        <span class="cs-metric-sub">Ort. Enerji %${cs.avgEnergy}</span>
      </div>
      <div class="cs-metric-card cs-metric-wide">
        <span class="cs-metric-lbl">🎛️ Frekans Karakteri</span>
        <strong class="cs-metric-val">${escapeHtml(cs.dominantBand)}</strong>
        <span class="cs-metric-sub">Bas %${cs.bassPct} · Mid/Vokal %${cs.midPct} · Tiz %${cs.highPct}</span>
      </div>
    `;
  }

  function renderSceneCards() {
    const grid = $('#csScenesGrid');
    if (!grid) return;
    if (!cs.blocks.length) {
      grid.innerHTML = '';
      return;
    }
    grid.innerHTML = cs.blocks.map(b => {
      const extBadge = b.is_extension_candidate
        ? `<span class="cs-badge cs-badge-ext" title="Önceki sahnenin enerjisi kesintisiz devam ediyor">🔗 Uzatma Adayı (Scene Extension)</span>`
        : `<span class="cs-badge cs-badge-main">🖼️ Ana Sahne (NB2 + Omni Flash)</span>`;
      const dropBadge = b.has_drop_transition
        ? `<span class="cs-badge cs-badge-drop" title="Sessizlikten ani enerji patlaması tespit edildi">🔥 Drop +${b.drop_rel_sec}s</span>`
        : '';
      const peaksHtml = b.peaks.length
        ? b.peaks.map(p => `<button type="button" class="cs-peak-chip" data-seek="${p.abs}" title="Bu vuruşa atla (${p.abs}s)">⚡ +${p.rel.toFixed(1)}s</button>`).join('')
        : `<span class="muted small">Akıcı hareket (ani darbe yok)</span>`;
      const lyricsHtml = (b.lyrics_lines && b.lyrics_lines.length)
        ? `<div class="cs-scene-lyrics">${b.lyrics_lines.map(l => `<div><span class="muted">[+${l.rel.toFixed(1)}s]</span> ${escapeHtml(l.text)}</div>`).join('')}</div>`
        : '';

      return `
        <div class="cs-scene-card ${b.is_extension_candidate ? 'is-ext' : ''}" data-start="${b.start}">
          <div class="cs-scene-head">
            <button type="button" class="cs-scene-jump ghost small" data-seek="${b.start}" title="Bu sahneyi oynat">
              ▶ SAHNE ${String(b.scene).padStart(2, '0')} · ${secToMmss(b.start)} - ${secToMmss(b.end)} (${b.duration}sn)
            </button>
            ${extBadge}
            ${dropBadge}
            <span class="cs-badge cs-badge-arc">${escapeHtml(b.arc)}</span>
          </div>
          <div class="cs-scene-phases">
            <div class="cs-phase">
              <span>1. Evre (0s)</span>
              <div class="cs-bar"><div style="width:${b.e1}%"></div></div>
              <b>%${b.e1}</b>
            </div>
            <div class="cs-phase">
              <span>2. Evre</span>
              <div class="cs-bar"><div style="width:${b.e2}%"></div></div>
              <b>%${b.e2}</b>
            </div>
            <div class="cs-phase">
              <span>3. Evre</span>
              <div class="cs-bar"><div style="width:${b.e3}%"></div></div>
              <b>%${b.e3}</b>
            </div>
          </div>
          <div class="cs-scene-meta small">
            <span><b>Baskın:</b> ${escapeHtml(b.dominant_band)} (Bas %${b.bass} · Mid %${b.mid} · Tiz %${b.high} · Merkez ${b.centroid_hz || 0} Hz)</span>
          </div>
          <div class="cs-scene-hint small muted">💡 ${escapeHtml(b.visual_hint)}${b.lighting_hint ? ' · 🔆 ' + escapeHtml(b.lighting_hint) : ''}</div>
          ${lyricsHtml}
          <div class="cs-scene-peaks">${peaksHtml}</div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('[data-seek]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sec = parseFloat(btn.dataset.seek);
        const audio = $('#csAudio');
        if (audio && audio.src) {
          audio.currentTime = sec;
          audio.play().catch(() => {});
        }
      });
    });
  }

  // ===================================================================
  // LOAD SONG / FILE & EXPORTS
  // ===================================================================
  async function loadSongIntoStudio(song, autoAnalyze = true) {
    if (!song || !song.has_audio) {
      toast('Bu şarkının ses dosyası bulunmuyor.', true);
      return;
    }
    const sel = $('#csSongSelect');
    if (sel) {
      const idStr = String(song.id);
      if (!Array.from(sel.options).some(o => o.value === idStr)) {
        const opt = document.createElement('option');
        opt.value = idStr;
        const bpmTag = song.bpm ? ` · ${Math.round(song.bpm)} BPM` : '';
        opt.textContent = `${song.title}${song.artist ? ' — ' + song.artist : ''}${bpmTag}`;
        sel.appendChild(opt);
      }
      if (!cs.songs.some(s => s.id === song.id)) {
        cs.songs.push(song);
      }
      sel.value = idStr;
    }

    const url = `/api/music/songs/${song.id}/audio`;
    cs.audioUrl = url;
    const audioEl = $('#csAudio');
    if (audioEl) {
      audioEl.src = url;
      $('#csPlayerBar')?.classList.remove('hidden');
    }

    if (!autoAnalyze) return;

    try {
      setStatus(`⏳ Ses dosyası indiriliyor: ${song.title}...`, 'warn');
      const res = await fetch(url);
      if (!res.ok) throw new Error('Ses dosyası yüklenemedi');
      const buf = await res.arrayBuffer();
      await analyzeAudioSource(buf, `${song.title}.mp3`, song);
    } catch (e) {
      setStatus(`❌ Şarkı yüklenemedi: ${e.message}`, 'err');
      toast('Şarkı yüklenemedi: ' + e.message, true);
    }
  }

  async function loadLocalFile(file) {
    if (!file) return;
    if (cs.audioUrl && cs.audioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(cs.audioUrl);
    }
    const blobUrl = URL.createObjectURL(file);
    cs.audioUrl = blobUrl;
    const audioEl = $('#csAudio');
    if (audioEl) {
      audioEl.src = blobUrl;
      $('#csPlayerBar')?.classList.remove('hidden');
    }
    const sel = $('#csSongSelect');
    if (sel) sel.value = '';

    const buf = await file.arrayBuffer();
    await analyzeAudioSource(buf, file.name, null);
  }

  function exportPng300Dpi() {
    if (!cs.melMatrix) return;
    const offscreen = document.createElement('canvas');
    renderSpectrogramToCanvas(offscreen, 2600, 1180, null);
    offscreen.toBlob(blob => {
      if (!blob) return;
      const a = document.createElement('a');
      const base = (cs.fileName || 'spektrogram').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
      a.href = URL.createObjectURL(blob);
      a.download = `${base}_spektrogram.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('🖼️ Spektrogram PNG kaydedildi!');
    }, 'image/png');
  }

  function exportPremiereCsv() {
    if (!cs.duration) return;
    const fps = getFps();
    const boundaries = getSceneBoundaries();
    const rows = [
      ['Marker Name', 'Description', 'In', 'Out', 'Duration', 'Marker Type', 'Seconds'],
    ];

    for (let bi = 0; bi < boundaries.length - 1; bi++) {
      const sec = boundaries[bi];
      const endSec = boundaries[bi + 1];
      const durSec = Math.max(0, endSec - sec);
      const tcIn = secToTimecode(sec, fps);
      const tcOut = secToTimecode(endSec, fps);
      const durTc = secToTimecode(durSec, fps);
      rows.push([
        `SAHNE_${String(bi + 1).padStart(2, '0')} (${durSec.toFixed(1)}sn)`,
        `Omni Flash ${durSec.toFixed(1)}sn Video Sekansi`,
        tcIn,
        tcOut,
        durTc,
        'Subclip',
        sec.toFixed(3),
      ]);
    }

    cs.peakTimes.forEach((pt, i) => {
      const tc = secToTimecode(pt, fps);
      let sceneIdx = 0;
      for (let bi = 0; bi < boundaries.length - 1; bi++) {
        if (pt >= boundaries[bi] && pt <= boundaries[bi + 1]) {
          sceneIdx = bi;
          break;
        }
      }
      const relSec = Math.max(0, pt - (boundaries[sceneIdx] || 0));
      rows.push([
        `BEAT_PEAK_${String(i + 1).padStart(2, '0')}`,
        `Sahne ${String(sceneIdx + 1).padStart(2, '0')} ici (at +${relSec.toFixed(1)}s) Akustik Vurus`,
        tc,
        tc,
        '00:00:00:00',
        'Cue',
        pt.toFixed(3),
      ]);
    });

    const csv = '\ufeff' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    const base = (cs.fileName || 'music').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
    a.href = URL.createObjectURL(blob);
    a.download = `${base}_premiere_markers.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('🎬 Premiere Pro / DaVinci Marker CSV indirildi!');
  }

  async function saveAnalysisToVault() {
    if (!cs.currentSong || !cs.duration) return;
    const btn = $('#csBtnSaveDb');
    try {
      if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor...'; }
      const updated = await api(`/api/music/songs/${cs.currentSong.id}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bpm: cs.bpm,
          duration: cs.duration,
          block_duration: getBlockDuration(),
          fps: getFps(),
          peak_count: cs.peakTimes.length,
          avg_energy: cs.avgEnergy,
          bass_pct: cs.bassPct,
          mid_pct: cs.midPct,
          high_pct: cs.highPct,
          dominant_band: cs.dominantBand,
          peaks: cs.peakTimes,
          beats: cs.beatTimes,
          blocks: cs.blocks,
          vc_report: cs.vcReportText,
        }),
      });
      cs.currentSong = updated;
      toast('💾 Şarkı özellikleri & Klip Analiz verisi kasaya kaydedildi!');
      if (window.loadMusicSongs) window.loadMusicSongs();
    } catch (e) {
      toast('Kaydetme hatası: ' + e.message, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Özellikleri Kasaya Kaydet'; }
    }
  }

  async function loadVisualizerComposerPrompt() {
    if (cs.vcGemPrompt) return cs.vcGemPrompt;
    try {
      const data = await api('/api/music/visualizer-composer-prompt');
      cs.vcGemPrompt = data;
      const codeEl = $('#csGemPromptContent');
      if (codeEl) codeEl.textContent = data.content || '';
      return data;
    } catch (e) {
      console.error('VC prompt load failed:', e);
      return null;
    }
  }

  let _refreshPromise = null;
  async function refreshSongDropdown(songsList = null) {
    const sel = $('#csSongSelect');
    if (!sel) return;
    if (!songsList && _refreshPromise) {
      return _refreshPromise;
    }
    const run = async () => {
      try {
        if (!songsList) {
          const res = await api('/api/music/songs?limit=500');
          songsList = res.items || [];
        }
        cs.songs = songsList.filter(s => s.has_audio);
        const curVal = sel.value;
        sel.innerHTML = '<option value="">🎵 Kasadan Sesli Şarkı Seç...</option>';
        cs.songs.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          const bpmTag = s.bpm ? ` · ${Math.round(s.bpm)} BPM` : '';
          opt.textContent = `${s.title}${s.artist ? ' — ' + s.artist : ''}${bpmTag}`;
          sel.appendChild(opt);
        });
        if (curVal && cs.songs.some(s => String(s.id) === String(curVal))) {
          sel.value = curVal;
        }
      } catch (e) {
        console.error('Could not populate clip studio song list:', e);
      } finally {
        _refreshPromise = null;
      }
    };
    if (!songsList) {
      _refreshPromise = run();
      return _refreshPromise;
    }
    return run();
  }

  // ===================================================================
  // INIT & EVENTS
  // ===================================================================
  function initClipStudio() {
    // Sub-tab switching inside Klip Analiz Stüdyosu
    $$('.cs-subtab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.cs-subtab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.dataset.csTab;
        $$('.cs-subpane').forEach(p => p.classList.add('hidden'));
        $(`#cs-pane-${target}`)?.classList.remove('hidden');
        if (target === 'spec') {
          drawSpectrogram();
          drawAnimatedSpectrogram();
        }
        if (target === 'gem') loadVisualizerComposerPrompt();
      });
    });

    // Analyze selected song from vault
    $('#csBtnAnalyzeSong')?.addEventListener('click', () => {
      const selId = parseInt($('#csSongSelect')?.value || '', 10);
      const song = cs.songs.find(s => s.id === selId);
      if (!song) return toast('Lütfen kasadan ses dosyası olan bir şarkı seçin.', true);
      loadSongIntoStudio(song, true);
    });

    // Local file input
    $('#csFileInput')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) loadLocalFile(file);
    });

    // Recalculate blocks when segment mode/size, fps, or lyrics toggle changes
    const recomputeAll = () => {
      if (!cs.timesArr) return;
      cs.autoSceneCuts = computeAutoSceneCuts(getBlockDuration(), getSegMode());
      cs.sceneCuts = [...cs.autoSceneCuts];
      recalculateBlocksAndReport();
      drawSpectrogram();
      drawAnimatedSpectrogram();
    };
    $('#csSegMode')?.addEventListener('change', recomputeAll);
    $('#csSegmentSelect')?.addEventListener('change', recomputeAll);
    $('#csFpsSelect')?.addEventListener('change', () => {
      if (cs.timesArr) recalculateBlocksAndReport();
    });
    $('#csIncludeLyrics')?.addEventListener('change', () => {
      if (cs.timesArr) {
        recalculateBlocksAndReport();
        drawAnimatedSpectrogram();
      }
    });

    // View mode selector (Tam + Canli / Tam / Canli)
    $('#csViewMode')?.addEventListener('change', (e) => {
      const mode = e.target.value;
      $('#csGridWrap')?.classList.toggle('hidden', mode === 'anim');
      $('#csAnimWrap')?.classList.toggle('hidden', mode === 'grid');
      if (cs.melMatrix) {
        drawSpectrogram();
        drawAnimatedSpectrogram();
      }
    });

    // Editor toolbar buttons
    $$('.cs-tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.cs-tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        cs.tool = btn.dataset.tool || 'move';
        const c = $('#csSpecCanvas');
        if (c) {
          c.style.cursor = cs.tool === 'split' ? 'crosshair' : (cs.tool === 'peak' ? 'cell' : (cs.tool === 'erase' ? 'not-allowed' : 'pointer'));
        }
      });
    });

    $('#csBtnResetEdits')?.addEventListener('click', () => {
      if (!cs.timesArr) return;
      cs.peakTimes = [...(cs.autoPeakTimes || [])];
      cs.autoSceneCuts = computeAutoSceneCuts(getBlockDuration(), getSegMode());
      cs.sceneCuts = [...cs.autoSceneCuts];
      recalculateBlocksAndReport();
      drawSpectrogram();
      drawAnimatedSpectrogram();
      toast('↺ Sahne sınırları ve vuruşlar otomatik haline sıfırlandı.');
    });

    // Redraw spectrogram on visual option change
    ['#csScaleSelect', '#csCmapSelect', '#csShowPeaks', '#csShowGrid'].forEach(sel => {
      $(sel)?.addEventListener('change', () => {
        drawSpectrogram();
        drawAnimatedSpectrogram();
      });
    });

    // Exports & Save & WebM Recording
    $('#csBtnSavePng')?.addEventListener('click', exportPng300Dpi);
    $('#csBtnRecordWebm')?.addEventListener('click', toggleRecordWebm);
    $('#csBtnPremiere')?.addEventListener('click', exportPremiereCsv);
    $('#csBtnSaveDb')?.addEventListener('click', saveAnalysisToVault);
    $('#csBtnCopyVc')?.addEventListener('click', async () => {
      if (!cs.vcReportText) return;
      await navigator.clipboard.writeText(cs.vcReportText);
      toast('📋 Visualizer Composer Veri Paketi panoya kopyalandı!');
    });

    // Gem Prompt actions
    $('#csBtnCopyGem')?.addEventListener('click', async () => {
      const data = await loadVisualizerComposerPrompt();
      if (!data?.content) return toast('Sistem promptu yüklenemedi', true);
      await navigator.clipboard.writeText(data.content);
      toast('💎 Visualizer Composer Gem Sistem Promptu kopyalandı!');
    });

    $('#csBtnSaveGemToSys')?.addEventListener('click', async () => {
      const data = await loadVisualizerComposerPrompt();
      if (!data?.content) return toast('Sistem promptu yüklenemedi', true);
      try {
        await api('/api/system-prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        toast('🧠 Visualizer Composer, Sistem Promptları (Gemini Gems) bölümüne eklendi!');
      } catch (e) {
        toast('Eklenemedi: ' + e.message, true);
      }
    });

    // Audio playhead sync + canvas click/drag editing + hover tooltip
    const audio = $('#csAudio');
    if (audio) {
      audio.addEventListener('play', startPlayheadLoop);
      audio.addEventListener('pause', () => {
        cancelAnimationFrame(cs.rafId);
        drawSpectrogram();
        drawAnimatedSpectrogram();
      });
      audio.addEventListener('seeked', () => {
        drawSpectrogram();
        drawAnimatedSpectrogram();
      });
      audio.addEventListener('ended', () => {
        cancelAnimationFrame(cs.rafId);
        if (cs.recording && cs.recorder) cs.recorder.stop();
        drawSpectrogram();
        drawAnimatedSpectrogram();
      });
    }

    const canvas = $('#csSpecCanvas');
    const tooltip = $('#csCanvasTooltip');
    if (canvas) {
      const getCanvasTime = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const cx = (e.clientX - rect.left) * scaleX;
        const { x, w } = cs.plotRect;
        if (cx < x || cx > x + w || !cs.duration) return null;
        return { cx, t: ((cx - x) / w) * cs.duration };
      };

      const findNearestCutIndex = (cx, maxPx = 10) => {
        const { x, w } = cs.plotRect;
        let bestIdx = -1;
        let bestDist = maxPx;
        for (let i = 0; i < cs.sceneCuts.length; i++) {
          const cutX = x + (cs.sceneCuts[i] / cs.duration) * w;
          const d = Math.abs(cx - cutX);
          if (d <= bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        return bestIdx;
      };

      const findNearestPeakIndex = (cx, maxPx = 9) => {
        const { x, w } = cs.plotRect;
        let bestIdx = -1;
        let bestDist = maxPx;
        for (let i = 0; i < cs.peakTimes.length; i++) {
          const pX = x + (cs.peakTimes[i] / cs.duration) * w;
          const d = Math.abs(cx - pX);
          if (d <= bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        return bestIdx;
      };

      const addSplitCutAt = (t) => {
        const bounds = getSceneBoundaries();
        let prevB = 0, nextB = cs.duration;
        for (let bi = 0; bi < bounds.length - 1; bi++) {
          if (t >= bounds[bi] && t <= bounds[bi + 1]) {
            prevB = bounds[bi];
            nextB = bounds[bi + 1];
            break;
          }
        }
        if (t - prevB < 3.0 || nextB - t < 3.0) {
          toast('⚠️ Omni Flash için her sahne en az 3.0 saniye olmalıdır.', true);
          return;
        }
        cs.sceneCuts.push(Number(t.toFixed(2)));
        cs.sceneCuts.sort((a, b) => a - b);
        recalculateBlocksAndReport();
        drawSpectrogram();
        drawAnimatedSpectrogram();
      };

      const tryDeleteAt = (cx) => {
        const cutIdx = findNearestCutIndex(cx, 11);
        if (cutIdx !== -1) {
          const prevB = cutIdx > 0 ? cs.sceneCuts[cutIdx - 1] : 0;
          const nextB = cutIdx < cs.sceneCuts.length - 1 ? cs.sceneCuts[cutIdx + 1] : cs.duration;
          const merged = nextB - prevB;
          if (merged > 15.05) {
            toast(`⚠️ Bu sınır silinirse sahne ${merged.toFixed(1)}sn olur! Omni Flash maksimum 15.0sn sınırına takılır.`, true);
            return true;
          }
          cs.sceneCuts.splice(cutIdx, 1);
          recalculateBlocksAndReport();
          drawSpectrogram();
          drawAnimatedSpectrogram();
          return true;
        }
        const peakIdx = findNearestPeakIndex(cx, 10);
        if (peakIdx !== -1) {
          cs.peakTimes.splice(peakIdx, 1);
          recalculateBlocksAndReport();
          drawSpectrogram();
          drawAnimatedSpectrogram();
          return true;
        }
        return false;
      };

      canvas.style.touchAction = 'pan-y';

      const finishDrag = () => {
        if (!cs.isDraggingCut) return;
        const idx = cs.dragCutIdx;
        cs.isDraggingCut = false;
        cs.dragCutIdx = -1;
        canvas.style.touchAction = 'pan-y';
        if (cs.didDrag && idx >= 0) {
          recalculateBlocksAndReport();
          drawSpectrogram();
          drawAnimatedSpectrogram();
        }
      };

      canvas.addEventListener('pointerdown', (e) => {
        if ((e.pointerType === 'mouse' && e.button !== 0) || !cs.duration) return;
        const pos = getCanvasTime(e);
        if (!pos) return;
        const hitPx = e.pointerType === 'touch' ? 20 : 10;
        if (cs.tool === 'move' && !e.shiftKey && !e.altKey) {
          const cutIdx = findNearestCutIndex(pos.cx, hitPx);
          if (cutIdx !== -1) {
            cs.isDraggingCut = true;
            cs.dragCutIdx = cutIdx;
            cs.didDrag = false;
            canvas.style.touchAction = 'none';
            if (canvas.setPointerCapture) {
              try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
            }
            e.preventDefault();
          }
        }
      });

      canvas.addEventListener('pointerup', finishDrag);
      canvas.addEventListener('pointercancel', finishDrag);
      window.addEventListener('pointerup', finishDrag);

      canvas.addEventListener('click', (e) => {
        if (cs.didDrag) {
          cs.didDrag = false;
          return;
        }
        const pos = getCanvasTime(e);
        if (!pos) return;
        if (e.shiftKey || cs.tool === 'split') {
          addSplitCutAt(pos.t);
          return;
        }
        if (e.altKey || cs.tool === 'peak') {
          cs.peakTimes.push(Number(pos.t.toFixed(2)));
          cs.peakTimes.sort((a, b) => a - b);
          recalculateBlocksAndReport();
          drawSpectrogram();
          drawAnimatedSpectrogram();
          return;
        }
        if (cs.tool === 'erase') {
          if (!tryDeleteAt(pos.cx)) {
            toast('Silmek için sarı sahne sınırına veya turkuaz vuruş çizgisine tıklayın.', true);
          }
          return;
        }
        if (!audio?.src) return;
        audio.currentTime = Math.max(0, Math.min(cs.duration, pos.t));
        if (audio.paused) audio.play().catch(() => {});
        drawSpectrogram();
        drawAnimatedSpectrogram();
      });

      canvas.addEventListener('contextmenu', (e) => {
        const pos = getCanvasTime(e);
        if (!pos) return;
        e.preventDefault();
        tryDeleteAt(pos.cx);
      });

      canvas.addEventListener('pointermove', (e) => {
        if (!cs.duration) return;
        const pos = getCanvasTime(e);
        if (!pos) {
          tooltip?.classList.add('hidden');
          return;
        }
        if (cs.isDraggingCut && cs.dragCutIdx >= 0) {
          const i = cs.dragCutIdx;
          const prevB = i > 0 ? cs.sceneCuts[i - 1] : 0;
          const nextB = i < cs.sceneCuts.length - 1 ? cs.sceneCuts[i + 1] : cs.duration;
          // 3.0s min AND 15.0s Omni Flash max kıskacı
          const minT = Math.max(prevB + 3.0, nextB - 15.0);
          const maxT = Math.min(nextB - 3.0, prevB + 15.0);
          const clamped = Math.max(minT, Math.min(maxT, pos.t));
          cs.sceneCuts[i] = Number(clamped.toFixed(2));
          cs.didDrag = true;
          drawSpectrogram();
          if (tooltip) {
            tooltip.textContent = `Sınır Taşınıyor: ${secToMmss(clamped)} | S${String(i + 1).padStart(2, '0')}: ${(clamped - prevB).toFixed(1)}sn · S${String(i + 2).padStart(2, '0')}: ${(nextB - clamped).toFixed(1)}sn`;
            tooltip.classList.remove('hidden');
          }
          return;
        }

        if (cs.tool === 'move' && e.pointerType !== 'touch') {
          canvas.style.cursor = findNearestCutIndex(pos.cx, 10) !== -1 ? 'ew-resize' : 'pointer';
        }

        if (tooltip) {
          const bounds = getSceneBoundaries();
          let sceneIdx = 0;
          for (let bi = 0; bi < bounds.length - 1; bi++) {
            if (pos.t >= bounds[bi] && pos.t <= bounds[bi + 1]) {
              sceneIdx = bi;
              break;
            }
          }
          const rel = Math.max(0, pos.t - (bounds[sceneIdx] || 0));
          tooltip.textContent = `${secToMmss(pos.t)} (${pos.t.toFixed(2)}s) · Sahne ${String(sceneIdx + 1).padStart(2, '0')} (+${rel.toFixed(1)}s)`;
          tooltip.classList.remove('hidden');
        }
      });

      canvas.addEventListener('pointerleave', () => {
        if (!cs.isDraggingCut) tooltip?.classList.add('hidden');
      });
    }

    window.addEventListener('resize', () => {
      if (cs.melMatrix && $('#tab-music-clip-studio')?.classList.contains('active')) {
        drawSpectrogram();
        drawAnimatedSpectrogram();
      }
    });
  }

  window.ClipStudio = {
    openForSong: async (song) => {
      // Switch to music domain if not already active
      if (window.switchDomain) window.switchDomain('music');
      // Click the Clip Studio tab button
      const tabBtn = $('#tabs-music button[data-music-tab="clip-studio"]');
      if (tabBtn) tabBtn.click();
      await refreshSongDropdown();
      await loadSongIntoStudio(song, true);
    },
    onTabActivated: async () => {
      await refreshSongDropdown();
      if (cs.melMatrix) {
        drawSpectrogram();
        drawAnimatedSpectrogram();
      }
    },
    refreshSongDropdown,
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initClipStudio);
  } else {
    initClipStudio();
  }
})();
