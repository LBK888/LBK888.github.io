// Synthetic water-quality stream that speaks the ESP32 protocol (same schema and frames),
// so the rest of the app cannot tell it apart except by the "DEMO" labels.
import {rng} from './forecast.js';

export const DEMO_SCENARIOS = {events: 'Random events', calm: 'Calm water', trend: 'Steady heating'};
export const DEMO_MISSING = {none: 0, some: .05, many: .15};

export function demoSchema(intervalMs) {
  return {schema_version: 1, sample_interval_ms: intervalMs, channels: [
    {id: 'temperature', name: 'Water temperature', type: 'number', item_key: 'temperature', unit: '°C', decimals: 2, minimum: -10, maximum: 85},
    {id: 'tds', name: 'TDS', type: 'number', item_key: 'tds', unit: 'ppm', decimals: 1, minimum: 0, maximum: 1000}]};
}

export class DemoSource {
  constructor({intervalMs = 1000, scenario = 'events', missing = 'some', seed = Date.now() % 2 ** 31} = {}) {
    this.intervalMs = intervalMs; this.scenario = scenario; this.missingRate = DEMO_MISSING[missing] ?? 0;
    this.rand = rng(seed); this.seq = 0; this.burst = 0;
    this.deviceId = `DEMO-${Math.floor(this.rand() * 0xffffff).toString(16).toUpperCase().padStart(6, '0')}`;
    this.bootId = Array.from({length: 16}, () => Math.floor(this.rand() * 16).toString(16)).join('').toUpperCase();
    this.tempNoise = 0; this.tdsNoise = 0; this.drift = 0; this.heat = null; this.spill = null;
  }
  gauss() { const u = 1 - this.rand(), v = this.rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  // Event shape: linear rise for `rise` seconds, then exponential decay with time constant `tau`.
  pulse(e, t) {
    if (!e || t < e.start) return 0;
    const age = t - e.start;
    return age < e.rise ? e.size * age / e.rise : e.size * Math.exp(-(age - e.rise) / e.tau);
  }
  values(t) {
    // Slow random-walk wander (real water) + white measurement noise (ADC / probe).
    const dt = this.intervalMs / 1000, r = Math.sqrt(dt);
    this.tempNoise += .006 * this.gauss() * r - .002 * dt * this.tempNoise;
    this.tdsNoise += .8 * this.gauss() * r - .01 * dt * this.tdsNoise;
    this.drift += .004 * this.gauss() * r;
    if (this.scenario === 'events') {
      if ((!this.heat || t - this.heat.start > 400) && this.rand() < dt / 240) this.heat = {start: t, rise: 30 + 30 * this.rand(), tau: 90, size: 3 + 3 * this.rand()};
      if ((!this.spill || t - this.spill.start > 300) && this.rand() < dt / 200) this.spill = {start: t, rise: 4 + 6 * this.rand(), tau: 50, size: 120 + 120 * this.rand()};
    }
    const trend = this.scenario === 'trend' ? 4 * Math.sin(2 * Math.PI * t / 900) : 0;
    const wave = this.scenario === 'calm' ? .3 : 1.2;
    const water = 25 + wave * Math.sin(2 * Math.PI * t / 240) + this.drift + trend + this.pulse(this.heat, t) + this.tempNoise;
    const temperature = water + .03 * this.gauss();
    const tds = 360 + 25 * Math.sin(2 * Math.PI * t / 180 + 1) + 4 * (water - 25) + this.pulse(this.spill, t) + this.tdsNoise + 2 * this.gauss();
    return {temperature: Math.min(85, Math.max(-10, temperature)), tds: Math.min(1000, Math.max(0, tds))};
  }
  // Returns an ESP32-style frame, or null when the packet is "lost" (a real missing tick).
  next() {
    const seq = this.seq++, uptime = seq * this.intervalMs, t = uptime / 1000, v = this.values(t);
    if (this.burst > 0) { this.burst--; return null; }
    if (this.missingRate >= .15 && this.rand() < this.intervalMs / 120000) { this.burst = 3 + Math.floor(this.rand() * 6); return null; }
    if (this.rand() < this.missingRate * .6) return null;
    const fault = this.rand() < this.missingRate * .4;
    return {type: 'sample', protocol_version: '1.0', device_id: this.deviceId, boot_id: this.bootId, schema_version: 1, seq, uptime_ms: uptime,
      data: {temperature: fault ? null : Math.round(v.temperature * 100) / 100, tds: Math.round(v.tds * 10) / 10},
      quality: {temperature: fault ? 'DEMO_SENSOR_FAULT' : 'VALID', tds: 'VALID'}};
  }
  info() {
    return {protocol_version: '1.0', device_id: this.deviceId, boot_id: this.bootId, demo: true,
      wifi: {ssid: 'Phone demo generator', channel: '—'}};
  }
}
