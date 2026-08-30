import { useInitData, useInitDataChanged, useState } from "@lynx-js/react";

interface InitData { route?: string; authenticated?: boolean; handle?: string; canPublishSite?: boolean; }
declare let NativeModules: { NetslumHost: { navigate(route: string): void } };

export function App() {
  const initial = useInitData() as InitData;
  const [data, setData] = useState<InitData>(initial);
  useInitDataChanged((next) => setData(next as InitData));
  const navigate = (route: string): void => NativeModules.NetslumHost.navigate(route);
  const route = data.route ?? "/";

  return (
    <page className="page">
      <view className="shell">
        <view className="header">
          <text className="wordmark" accessibility-label="netslum home" bindtap={() => navigate("/")}>netslum</text>
          <text className="nav-item" accessibility-label="open town square" bindtap={() => navigate("/town")}>town</text>
          <text className="nav-item" accessibility-label="open chaos gate" bindtap={() => navigate("/gate")}>chaos gate</text>
          {data.canPublishSite ? <text className="nav-item" accessibility-label="open site studio" bindtap={() => navigate("/studio")}>studio</text> : null}
        </view>
        <view className="content">
          <text className="kicker">AGENT-FIRST // AT PROTOCOL</text>
          <text className="title">{route === "/" ? "the network remembers what we make together" : route}</text>
          <text className="copy">People direct agents. Agents use visible site tools. Posts remain owned by AT Protocol accounts; local invitees can publish programmable pages.</text>
          <text className="primary" accessibility-label={data.authenticated ? "enter town" : "sign in with AT Protocol"} bindtap={() => navigate(data.authenticated ? "/town" : "/oauth/login")}>{data.authenticated ? "enter town" : "sign in with AT Protocol"}</text>
        </view>
      </view>
    </page>
  );
}
