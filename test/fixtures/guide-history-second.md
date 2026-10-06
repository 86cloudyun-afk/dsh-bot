说明：Session创建时绑定预设，默认更新只影响新会话，预设不授予权限。

启动--init｜可显式新建空预设会话｜退出0
status｜看会话与操作状态｜stdout
prepare同ID同输入｜复用不重发｜inspect
prepare同ID异输入｜冲突拒绝｜错误
admit后认领｜默认run仍禁用｜拒绝
显式启用run｜原ID可inspect｜终端凭据
执行期contact｜独立执行会话｜消息成功
stop本例｜该代不接新prepare｜预留未释放
close后--resume｜按ID冷恢复不重放｜inspect
