/**
 * 站点适配器公共工具（阶段 2 / 10）。
 *
 * 把"生成注入脚本"的重复逻辑集中在此，各平台文件只声明选择器与 Profile。
 * 所有脚本必须容错：找不到元素返回 null/false，绝不抛异常。
 */
import type { SiteAdapter, ChunkingProfile } from '@shared/adapter'

/** 生成"写入输入框"的脚本（文本用占位符由主进程替换） */
export function buildInsertScript(textLiteral: string, selectors: string[]): string {
  return `(() => {
  try {
    const selectors = ${JSON.stringify(selectors)};
    const text = ${textLiteral};
    let el = null;
    for (const s of selectors) {
      const found = document.querySelector(s);
      if (found) { el = found; break; }
    }
    if (!el) return { ok: false, error: 'input-not-found' };
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, kind: 'textarea' };
    }
    if (el.isContentEditable) {
      // React 系编辑器（DeepSeek/ChatGPT）用 execCommand 常常无效，
      // 因为它们只信任真实的 beforeinput/input 事件序列。
      // 策略：先尝试 execCommand，再用原生 setter 兜底，最后校验是否真的写进去了。
      el.focus();

      let wrote = false;
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        // beforeinput 先行（部分编辑器据此更新内部 state）
        try {
          el.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true, cancelable: true, inputType: 'insertText', data: text
          }));
        } catch (e) { /* 老内核忽略 */ }
        wrote = document.execCommand('insertText', false, text);
      } catch (e) { wrote = false; }

      // 校验 execCommand 是否真的生效
      const readBack = () => (el.innerText || el.textContent || '');
      if (!wrote || readBack().indexOf(text.slice(0, 20)) < 0) {
        // 兜底 1：直接设置 textContent 后再补事件
        el.textContent = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      }

      // 兜底 2：仍为空则尝试用剪贴板事件（部分编辑器监听 paste）
      if (readBack().length === 0) {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
        } catch (e) { /* 忽略 */ }
      }

      return readBack().length > 0
        ? { ok: true, kind: 'contenteditable', len: readBack().length }
        : { ok: false, error: 'not-editable' };
    }
    return { ok: false, error: 'not-editable' };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
})()`
}

/** 读取输入框内容 */
export function buildExtractDraftScript(selectors: string[]): string {
  return `(() => {
  try {
    const sels = ${JSON.stringify(selectors)};
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || null;
      if (el.isContentEditable) return (el.innerText || el.textContent || '').trim() || null;
    }
    return null;
  } catch (err) { return null; }
})()`
}

/** 读取最后一条助手回复 */
export function buildExtractReplyScript(selectors: string[]): string {
  return `(() => {
  try {
    const selectors = ${JSON.stringify(selectors)};
    let nodes = [];
    for (const s of selectors) {
      const found = document.querySelectorAll(s);
      if (found && found.length) { nodes = Array.from(found); break; }
    }
    if (!nodes.length) return null;
    const last = nodes[nodes.length - 1];
    const text = (last.innerText || last.textContent || '').trim();
    return text || null;
  } catch (err) { return null; }
})()`
}

/**
 * 是否仍在流式输出。
 *
 * ⚠️ 实测 DeepSeek **没有** aria-label="Stop" 的停止按钮，
 * 它在生成期间把发送键（`div.ds-button--primary.ds-button--filled.ds-button--circle`）
 * 换成"停止"图标，且不暴露任何语义标签。
 * 因此判定改为多信号综合，任一命中即认为仍在生成：
 *   1. 存在明确的停止按钮（ChatGPT 等站点的通用做法）
 *   2. 回复容器内出现 loading/typing/streaming/cursor 类名
 *   3. 回复文本以光标字符结尾
 *   4. 发送键处于"生成中"形态（id 前缀变化 / 出现停止语义的 svg）
 *   5. 回复容器仍在增长（由主进程的稳定检测兜底，这里不重复实现）
 *
 * 注意：漏判(true)是安全的——主进程还有 STREAM_IDLE_MS 空闲兜底；
 * 误判(false)才危险，会导致长回复被截断，所以这里宁可宽松。
 */
export function buildStreamingScript(replySelectors: string[]): string {
  return `(() => {
  try {
    // 1) 明确的停止按钮
    const stop = document.querySelector(
      'button[aria-label*="Stop" i], button[aria-label*="停止"], [data-testid="stop-button"], [data-testid="stop-generating"]'
    );
    if (stop) return true;

    const selectors = ${JSON.stringify(replySelectors)};
    let nodes = [];
    for (const s of selectors) {
      const found = document.querySelectorAll(s);
      if (found && found.length) { nodes = Array.from(found); break; }
    }
    if (!nodes.length) return false;
    const last = nodes[nodes.length - 1];

    // 2) 容器内的生成中标记
    const busy = last.querySelector('[class*="loading" i], [class*="typing" i], [class*="cursor" i], [class*="streaming" i]');
    if (busy) return true;

    // 3) 末尾光标字符
    const t = (last.innerText || '').trimEnd();
    if (t.endsWith('▍') || t.endsWith('▌') || t.endsWith('|')) return true;

    // 4) 发送键"生成中"形态。
    //    ⚠️ 不能用"发送键禁用"来判断：生成结束后输入框为空，发送键同样是禁用的，
    //    那样会导致永远认为在生成（实测踩过这个坑：回复早已完成却一直 streaming=true）。
    //    改为检测生成期间才出现的停止语义图标（方形/停止 svg 或 stop 相关 class）。
    const send = document.querySelector('div.ds-button--circle.ds-button--primary');
    if (send) {
      const html = (send.innerHTML || '').toLowerCase();
      const cls = (send.className || '').toString().toLowerCase();
      if (cls.indexOf('stop') >= 0 || html.indexOf('stop') >= 0) return true;
    }
    return false;
  } catch (err) { return false; }
})()`
}

/**
 * 登录态检测。
 *
 * ⚠️ 关键：**不能只看输入框存在与否**。
 * 未登录时 DeepSeek/ChatGPT 等页面同样会渲染一个输入框（欢迎页），
 * 且未登录页面上必然出现「登录」字样，因此必须**先查未登录特征**。
 *
 * 判定顺序：
 *  1. URL 命中 /login、/signin、/auth → 一定未登录
 *  2. 明确的「登录/注册」按钮存在 → 未登录（优先级高于输入框）
 *  3. 输入框存在 → 已登录
 *  4. 出现「注销/退出登录/我的账号/历史对话」等登录后特征 → 已登录
 *  5. 否则 unknown
 */
export function buildLoginScript(inputSelectors: string[]): string {
  return `(() => {
  try {
    const sels = ${JSON.stringify(inputSelectors)};
    const href = location.href || '';

    // 1) 登录页 URL
    //    注意：DeepSeek 用的是 /sign_in（下划线），不能只匹配 sign-in / signin
    if (/[/?#](login|sign[_\-]?in|sign[_\-]?up|auth|passport|account\/login)([/?#]|$)/i.test(href)) {
      return 'logged-out';
    }

    const bodyText = (document.body.innerText || '').slice(0, 5000);

    // 2) 明确的登录/注册入口（未登录页的强特征）
    //    用精确按钮文案匹配，避免正文里出现"登录"二字就误判
    const authBtnRe = /^(登录|注册|立即登录|登录\\/注册|Log ?in|Sign ?in|Sign ?up)$/i;
    const clickables = document.querySelectorAll('button, a[role="button"], a[href]');
    for (const el of clickables) {
      const t = (el.innerText || el.textContent || '').trim();
      if (t && t.length <= 12 && authBtnRe.test(t)) return 'logged-out';
    }

    // 3) 已登录的强特征（出现即已登录，优先级高于输入框）
    if (/注销|退出登录|退出帳號|退出账号|Log ?out|Sign ?out|我的账号|账号设置|历史对话|新对话|搜索历史|深度思考|联网搜索|附件|发送消息/i.test(bodyText)) {
      return 'logged-in';
    }
    // 3b) 输入框的 placeholder / aria-label 也算强特征（DeepSeek 实测）
    for (const s of sels) {
      const node = document.querySelector(s);
      if (node) {
        const ph = (node.getAttribute && (node.getAttribute('placeholder') || node.getAttribute('aria-label'))) || '';
        if (/发送消息|Send a message|Ask anything|给 DeepSeek|输入/i.test(ph)) return 'logged-in';
      }
    }

    // 4) 输入框存在 → 已登录
    for (const s of sels) {
      if (document.querySelector(s)) return 'logged-in';
    }
    if (document.querySelector('textarea, [contenteditable="true"]')) return 'logged-in';

    // 5) URL 已经是站内对话页（含子路径）
    if (/deepseek\.com\/(a\/chat|chat)/i.test(href)) return 'logged-in';
    if (/chatgpt\.com\/?$/i.test(href)) return 'logged-in';
    if (/claude\.ai\/new/i.test(href) || /claude\.ai\/chat/i.test(href)) return 'logged-in';

    // 6) 兜底
    if (/登录|log ?in|sign ?in/i.test(bodyText)) return 'logged-out';
    return 'unknown';
  } catch (err) { return 'unknown'; }
})()`
}

/** 生成"点击发送"脚本 */
export function buildSubmitScript(sendSelectors: string[], inputSelectors: string[]): string {
  return `(() => {
  try {
    const sels = ${JSON.stringify(sendSelectors)};
    const inputSels = ${JSON.stringify(inputSelectors)};

    // 1) 按声明顺序找发送按钮
    for (const s of sels) {
      const btn = document.querySelector(s);
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
        btn.click();
        return { ok: true, via: s };
      }
    }

    const input = document.querySelector(inputSels[0] || '') ||
                  document.querySelector('textarea') ||
                  document.querySelector('div[contenteditable="true"]');

    // 2) 兜底：在输入框附近按特征找"可点击且非禁用"的按钮
    //    许多站点改版后 class 变化，但"最后一个可点按钮"通常是发送键
    if (input) {
      const scope = input.closest('form') || input.parentElement?.parentElement || document;
      const btns = Array.from(scope.querySelectorAll('button, div[role="button"]'))
        .filter((b) => {
          const disabled = b.disabled === true || b.getAttribute('aria-disabled') === 'true';
          if (disabled) return false;
          // 排除明显的非发送按钮
          const label = (b.getAttribute('aria-label') || b.innerText || '').trim();
          if (/上传|附件|attach|upload|microphone|voice|语音|清空|clear/i.test(label)) return false;
          return true;
        });
      // 取最后一个（发送键通常在输入区最右侧）
      const cand = btns[btns.length - 1];
      if (cand) {
        cand.click();
        return { ok: true, via: 'heuristic-last-button' };
      }
    }

    // 3) 最后退化为模拟回车
    if (input) {
      input.focus();
      for (const type of ['keydown', 'keypress', 'keyup']) {
        input.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
        }));
      }
      return { ok: true, via: 'enter' };
    }
    return { ok: false, error: 'send-not-found' };
  } catch (err) { return { ok: false, error: String(err) }; }
})()`
}

/** 通用分块提示词构造（无平台前缀） */
export function genericChunkPrompt(index: number, total: number, text: string, prevSummary?: string): string {
  if (index === 1) {
    return `我将分 ${total} 段发送文本，请按规则处理：收到每段只回复"已收到第 X/${total} 段"，不要处理。我发送"开始处理"后再统一处理。

第 1/${total} 段：
${text}`
  }
  const prev = prevSummary ? `（前文摘要：${prevSummary}）` : ''
  return `第 ${index}/${total} 段${prev}：
${text}`
}

/** 通用收尾提示词 */
export function genericFinalPrompt(task: string, summaries: string[]): string {
  const block = summaries.length
    ? `\n\n各段摘要：\n${summaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : ''
  return `开始处理。请综合所有段落，${task}。只输出结果，不要重复原文。${block}`
}

/** 构造一个站点适配器（收敛重复样板） */
export function createAdapter(config: {
  id: string
  name: string
  url: string
  matchPatterns: string[]
  inputSelectors: string[]
  sendButtonSelectors: string[]
  assistantMessageSelectors: string[]
  chunking: ChunkingProfile
}): SiteAdapter {
  const {
    id,
    name,
    url,
    matchPatterns,
    inputSelectors,
    sendButtonSelectors,
    assistantMessageSelectors,
    chunking
  } = config

  return {
    id,
    name,
    url,
    matchPatterns,
    inputSelectors,
    sendButtonSelectors,
    assistantMessageSelectors,
    loginIndicatorSelectors: inputSelectors,
    streamingIndicatorSelectors: ['button[aria-label*="Stop" i]', '[data-testid="stop-button"]'],
    chunking,
    extractDraftScript: () => buildExtractDraftScript(inputSelectors),
    insertDraftScript: (text: string) => buildInsertScript(JSON.stringify(text), inputSelectors),
    extractLastReplyScript: () => buildExtractReplyScript(assistantMessageSelectors),
    submitScript: () => buildSubmitScript(sendButtonSelectors, inputSelectors),
    streamingObserverScript: () => buildStreamingScript(assistantMessageSelectors),
    loginStateScript: () => buildLoginScript(inputSelectors)
  }
}
