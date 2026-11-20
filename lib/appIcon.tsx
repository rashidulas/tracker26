/** The app icon, drawn in code (app/icon.tsx, app/apple-icon.tsx). */
export function AppIcon({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0b0d',
      }}
    >
      <div
        style={{
          width: size * 0.72,
          height: size * 0.72,
          borderRadius: size * 0.18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#3dcea6',
          color: '#0a0b0d',
          fontSize: size * 0.34,
          fontWeight: 800,
          letterSpacing: -size * 0.01,
        }}
      >
        26
      </div>
    </div>
  );
}
