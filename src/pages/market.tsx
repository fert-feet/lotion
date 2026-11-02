// 插件市场页（/market）：从侧边栏进入，不再塞在设置弹窗里。
// 所有登录用户可浏览；安装/评分/市场源等管理操作由 canManage（owner）控制。
import { PluginMarket } from "@/components/settings/plugin-market";
import { useUser } from "@/hooks/use-user";

const MarketPage = () => {
  const { isOwner } = useUser();

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-6 py-5 sm:px-10">
      <PluginMarket canManage={isOwner} />
    </div>
  );
};

export default MarketPage;
