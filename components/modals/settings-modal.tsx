import useSettings from "../../hooks/use-setting";
import { ModeToggle } from "../lightButton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";

const SettingsModal = () => {
    const settings = useSettings();

    return (
        <Dialog open={settings.isOpen} onOpenChange={settings.onClose}>
            <DialogContent>
                <DialogHeader className="border-b-[0.5px] border-shell-border pb-3">
                    <DialogTitle>设置</DialogTitle>
                </DialogHeader>
                <div className="flex items-center justify-between pt-1">
                    <div className="flex flex-col gap-y-0.5">
                        <Label>外观</Label>
                        <span className="text-[12px] text-muted-foreground">
                            选择 Lotion 的显示主题
                        </span>
                    </div>
                    <ModeToggle />
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default SettingsModal;