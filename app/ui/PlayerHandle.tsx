export function PlayerHandle({
  username,
  className,
}: {
  username: string;
  className?: string;
}) {
  return <bdi className={className} dir="auto">@{username}</bdi>;
}
