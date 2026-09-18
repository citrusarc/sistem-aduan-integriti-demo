export function AuthHeading({
  title,
  description,
}: {
  title: string
  description?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-1">
      <p className="text-xs font-semibold tracking-wider text-accent uppercase">
        Sistem Aduan Integriti
      </p>
      <h1 className="text-xl font-semibold text-primary">{title}</h1>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  )
}
