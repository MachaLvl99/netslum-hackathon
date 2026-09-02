export interface NotFoundViewProps {
  navigate: (route: string) => void;
}

export function NotFoundView({ navigate }: NotFoundViewProps) {
  return (
    <view className="content">
      <text className="title">404 // NOT FOUND</text>
      <text className="primary" bindtap={() => navigate("/")}>RETURN TO NETSLUM &rarr;</text>
    </view>
  );
}