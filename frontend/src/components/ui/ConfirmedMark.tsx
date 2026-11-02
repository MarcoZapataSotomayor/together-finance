/** Render only alongside an outcome already confirmed by the server. */
export function ConfirmedMark() {
  return (
    <svg
      className="motion-confirmation-mark"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" pathLength="1" />
    </svg>
  )
}
