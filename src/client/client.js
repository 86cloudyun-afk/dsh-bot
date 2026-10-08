window.__ModuleLoader__.load({
  id: 'dsh-bot',
  factory(require) {
    const {createElement: h} = require('react');
    return {inject: ['slots', 'locale'], apply(ctx) {
      ctx.locale.define('zh', {'dsh.bot': {title: 'Bot 工作台', pending: '原生插件开发中；完整 v1 尚未交付'}});
      ctx.locale.define('en', {'dsh.bot': {title: 'Bot workbench', pending: 'Native plugin in development; full v1 is not delivered'}});
      function Workbench() { return h('section', {style: {padding: '24px', color: 'var(--dsw-alias-text-primary)'}}, h('h1', null, ctx.locale.t('dsh.bot.title')), h('p', null, ctx.locale.t('dsh.bot.pending'))); }
      ctx.slots.inject('main', () => ctx.slots.register({name: 'main', key: 'dsh-bot', id: 'dsh-bot'}, Workbench));
    }};
  }
});
