// Day/night cycle: sky colours, sun direction and light levels for a time of day.
// t in [0, 1): 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight.

import { smoothstep, lerp } from './math.js';

const DAY_ZENITH = [0.47, 0.65, 1.0];
const DAY_HORIZON = [0.74, 0.84, 1.0];
const NIGHT_ZENITH = [0.008, 0.01, 0.03];
const NIGHT_HORIZON = [0.03, 0.04, 0.08];
const SUNSET = [1.0, 0.42, 0.12];

const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function environment(t) {
  const a = t * Math.PI * 2;
  const elev = Math.sin(a);
  const sunDir = [Math.cos(a), elev, 0];
  const day = smoothstep(-0.2, 0.22, elev);
  const sunset = Math.max(0, 1 - Math.abs(elev) * 3.2);
  const zenith = mix3(NIGHT_ZENITH, DAY_ZENITH, day);
  let horizon = mix3(NIGHT_HORIZON, DAY_HORIZON, day);
  horizon = mix3(horizon, SUNSET, sunset * 0.35 * Math.max(day, 0.3));
  const fog = horizon;
  const sunlight = lerp(0.32, 1.0, day);
  const skyTint = mix3(mix3([0.55, 0.62, 0.95], [1, 1, 1], day), [1.0, 0.8, 0.62], sunset * 0.35);
  const stars = 1 - smoothstep(-0.25, 0.1, elev);
  const cloud = mix3([0.12, 0.13, 0.18], [1, 1, 1], day);
  const waterFog = mix3([0.01, 0.03, 0.08], [0.1, 0.24, 0.55], day);
  return { sunDir, zenith, horizon, fog, sunlight, skyTint, sunset, sunsetColor: SUNSET, stars, cloud, waterFog, day };
}

// CPU version of the shader light curve, for sprites and the held item.
export function lightBrightness(lightByte, sunlight) {
  const sky = ((lightByte >> 4) / 15) * sunlight;
  const blk = (lightByte & 15) / 15;
  const curve = (l) => {
    const b = Math.pow(0.82, (1 - l) * 15);
    return b + (Math.sqrt(b) - b) * 0.3;
  };
  return Math.max(curve(sky), curve(blk), 0.045);
}

export function timeLabel(t) {
  // Map t (0 = 6:00) to a 24h clock.
  const hours = (t * 24 + 6) % 24;
  const h = Math.floor(hours), m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
