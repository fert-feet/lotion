// 插件市场页（/market）：从侧边栏进入，不再塞在设置弹窗里。
import { PluginMarket } from "@/components/settings/plugin-market";
import { useUser } from "@/hooks/use-user";

const MarketPage = () => {
  const { isOwner } = useUser();

  if (!isOwner) {
    return (
      <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">插件市场</h1>
        <p className="text-[13px] leading-5 text-shell-label-tertiary">
          只有最早注册的用户（owner）可以管理插件市场。
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-6 py-5 sm:px-10">
      <PluginMarket />
    </div>
  );
};

export default MarketPage;
