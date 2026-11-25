import { useMemo } from 'react';
import { qrMatrix, qrPath } from '../qr.ts';

/** A crisp, scalable QR code drawn as SVG with the required quiet zone. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, d } = useMemo(() => {
    const m = qrMatrix(value);
    return { size: m.length, d: qrPath(m) };
  }, [value]);
  return (
    <svg className="qr" viewBox={`-4 -4 ${size + 8} ${size + 8}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x="-4" y="-4" width={size + 8} height={size + 8} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
