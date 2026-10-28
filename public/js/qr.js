import { QrRaw } from './qrcode-lib.js';

/** Small wrapper: pick the QR version that fits, byte mode, EC level M. */
export const Qr = {
  encode(text, level = 'M') {
    const qr = QrRaw(0, level);
    qr.addData(text, 'Byte');
    qr.make();
    const size = qr.getModuleCount();
    return {
      size,
      get(x, y) {
        return qr.isDark(y, x);
      },
    };
  },
};
