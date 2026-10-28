import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

export const PORT = Number(process.env.PORT || arg('port', 8090));
export const HOST = process.env.HOST || arg('host', '0.0.0.0');

export const STORAGE_ROOT = path.resolve(
  process.env.LANSHARE_ROOT || arg('root', path.join(APP_ROOT, 'files')),
);

export const DATA_DIR = path.join(APP_ROOT, 'data');
export const INTERNAL_DIR = path.join(STORAGE_ROOT, '.lanshare');
export const TRASH_DIR = path.join(INTERNAL_DIR, 'trash');
export const PARTIAL_DIR = path.join(INTERNAL_DIR, 'parts');

export const DEVICE_NAME = process.env.LANSHARE_NAME || arg('name', os.hostname());
export const MAX_UPLOAD_BYTES = Number(process.env.LANSHARE_MAX_UPLOAD || 1024 ** 4);
export const PUBLIC_DIR = path.join(APP_ROOT, 'public');

export function lanAddresses() {
  const out = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const node of list || []) {
      if (node.family === 'IPv4' && !node.internal) {
        out.push({ iface, address: node.address });
      }
    }
  }
  return out;
}

const VIRTUAL_IFACE = /^(tun|tap|Meta|utun|docker|br-|veth|virbr|vmnet|tailscale|zt|wg)/i;

/** Addresses worth showing to a phone on the same network. */
export function usableLanAddresses() {
  return lanAddresses().filter(({ address, iface }) => {
    if (VIRTUAL_IFACE.test(iface)) return false;
    if (address.startsWith('198.18.') || address.startsWith('198.19.')) return false;
    return true;
  });
}

/** The address a phone on the same Wi-Fi should actually use. */
export function primaryLanAddress() {
  const all = usableLanAddresses();
  const score = ({ address, iface }) => {
    if (VIRTUAL_IFACE.test(iface)) return -100;
    if (address.startsWith('198.18.') || address.startsWith('198.19.')) return -90; // benchmarking/Meta ranges
    if (address.startsWith('192.168.')) return 100;
    if (address.startsWith('10.')) return 90;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 80;
    return 10;
  };
  const ranked = all.map((n) => ({ ...n, score: score(n) })).sort((a, b) => b.score - a.score);
  return ranked[0] || null;
}
