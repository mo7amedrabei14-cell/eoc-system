const ERC_CRESCENT_PATH = "M 211.27 59.58 A 109.598 109.598 0 1 0 211.27 221.30 A 90.883 90.883 0 1 1 211.27 59.58 Z";

export default function ERCVectorLogo({ label = 'الهلال الأحمر المصري', decorative = false, className = '' }) {
  return (
    <svg
      className={`erc-vector-logo ${className}`.trim()}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 214 281"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? 'true' : undefined}
      focusable="false"
    >
      <path className="erc-vector-logo__path" pathLength="1000" d={ERC_CRESCENT_PATH} />
    </svg>
  );
}
