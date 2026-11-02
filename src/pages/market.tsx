// 插件市场页（/market）：从侧边栏进入，不再塞在设置弹窗里。
// 所有登录用户权限一致：浏览、安装、更新、评分、上传、市场源配置都可用。
import { PluginMarket } from "@/components/settings/plugin-market";

const MarketPage = () => (
  <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-6 py-5 sm:px-10">
    <PluginMarket />
  </div>
);

export default MarketPage;
