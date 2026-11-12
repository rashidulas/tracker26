export default function LoadError({ what }: { what: string }) {
  return (
    <div role="alert" className="p-4 bg-danger-dim border border-danger/25 rounded-2xl text-danger">
      Couldn&apos;t load {what}. Check the database connection and try again.
    </div>
  );
}
