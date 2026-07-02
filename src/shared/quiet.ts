// node:sqlite 在 Node 22 上会打 ExperimentalWarning，过滤掉避免污染 CLI 输出。
// 必须作为入口文件的第一个 import，才能在 node:sqlite 被加载前生效。
const original = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning') return;
  for (const listener of original) listener.call(process, warning);
});
