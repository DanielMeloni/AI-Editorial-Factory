import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex-1 space-y-6 p-4 sm:p-6">
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-44 w-full" />
        ))}
      </div>
      <span className="sr-only" role="status">
        Caricamento in corso
      </span>
    </div>
  );
}
