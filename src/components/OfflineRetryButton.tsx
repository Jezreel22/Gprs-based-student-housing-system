"use client";

/** Retry the current navigation after connectivity is restored. */
export function OfflineRetryButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      style={{
        marginTop: "1.5rem",
        width: "100%",
        height: "2.75rem",
        borderRadius: "0.75rem",
        border: "none",
        background: "#FF5A5F",
        color: "#fff",
        fontWeight: 600,
        fontSize: "0.95rem",
        cursor: "pointer",
      }}
    >
      Try again
    </button>
  );
}
