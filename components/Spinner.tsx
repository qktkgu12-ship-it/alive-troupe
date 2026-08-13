export default function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <div
      className={`animate-spin rounded-full border-2 border-red-100 border-t-red-500 ${className}`}
    />
  );
}
