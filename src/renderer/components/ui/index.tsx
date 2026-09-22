/**
 * 统一基础组件库（v3 P2-6.2）。
 *
 * 设计原则：
 *  - 不引第三方 UI 库（不增加 bundle 体积）
 *  - 所有颜色、间距、圆角、阴影、动效引用 --wa-* CSS 变量
 *  - 保留现有 wa-interactive / prefers-reduced-motion / dragging 短路
 *  - 与现有样式系统完全兼容（用 Tailwind class + 自定义 class）
 *
 * 组件清单：
 *  - Button / IconButton
 *  - Input / Textarea
 *  - Card
 *  - Modal / Drawer
 *  - Toast（轻量 hook + 渲染函数，不做全局 Portal，由调用方放）
 *  - Badge
 *  - Tabs
 *  - Tooltip
 *  - EmptyState / LoadingState / ErrorState
 *  - Spinner（圆形加载）
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'

/* ============================================================
 * 工具
 * ============================================================ */

function cx(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(' ')
}

function stopKey(e: KeyboardEvent<HTMLDivElement>, cb: () => void): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    cb()
  }
}

/* ============================================================
 * Button
 *  - 3 尺寸 / 5 变体 / 支持 loading / 支持 as="button" | as="a"
 *  - 默认 type="button"（避免表单误提交）
 * ============================================================ */

export type ButtonSize = 'sm' | 'md' | 'lg'
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'

export interface ButtonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  disabled?: boolean
  fullWidth?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
  type?: 'button' | 'submit' | 'reset'
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  className?: string
  style?: CSSProperties
  title?: string
  'aria-label'?: string
  children?: ReactNode
}

const SIZE_CLS: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1',
  md: 'h-8 px-3 text-sm gap-1.5',
  lg: 'h-10 px-4 text-base gap-2'
}

const VARIANT_CLS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--wa-accent)] text-white border border-transparent hover:bg-[var(--wa-accent-hover)] shadow-sm',
  secondary:
    'bg-[var(--wa-panel)] text-[var(--wa-text)] border border-[var(--wa-border)] hover:bg-[color:var(--wa-bg)]',
  ghost:
    'bg-transparent text-[var(--wa-text)] border border-transparent hover:bg-[color:var(--wa-border)]',
  danger:
    'bg-[var(--wa-danger)] text-white border border-transparent hover:opacity-90',
  link:
    'bg-transparent text-[var(--wa-accent)] border border-transparent hover:underline px-0 h-auto'
}

export function Button(props: ButtonProps): JSX.Element {
  const {
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabled = false,
    fullWidth = false,
    iconLeft,
    iconRight,
    type = 'button',
    onClick,
    className,
    style,
    title,
    children
  } = props

  const isDisabled = disabled || loading
  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      title={title}
      aria-label={props['aria-label']}
      aria-busy={loading || undefined}
      style={style}
      className={cx(
        'inline-flex items-center justify-center rounded-[var(--wa-radius-md)] font-medium select-none',
        'wa-interactive disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:transform-none',
        SIZE_CLS[size],
        VARIANT_CLS[variant],
        fullWidth && 'w-full',
        className
      )}
    >
      {loading ? <Spinner size="xs" /> : iconLeft}
      {children}
      {iconRight}
    </button>
  )
}

/* ============================================================
 * IconButton（圆形，仅图标）
 * ============================================================ */

export interface IconButtonProps {
  size?: ButtonSize
  variant?: ButtonVariant
  disabled?: boolean
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  title?: string
  'aria-label': string
  className?: string
  children: ReactNode
}

export function IconButton(props: IconButtonProps): JSX.Element {
  const { size = 'md', variant = 'ghost', disabled, onClick, title, className, children } = props
  const dim = size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-10 w-10' : 'h-8 w-8'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={props['aria-label']}
      className={cx(
        'inline-flex items-center justify-center rounded-[var(--wa-radius-md)] wa-interactive',
        'disabled:cursor-not-allowed disabled:opacity-50',
        dim,
        VARIANT_CLS[variant],
        className
      )}
    >
      {children}
    </button>
  )
}

/* ============================================================
 * Input / Textarea
 * ============================================================ */

export interface InputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'number' | 'password' | 'search'
  disabled?: boolean
  error?: string
  prefix?: ReactNode
  suffix?: ReactNode
  className?: string
  style?: CSSProperties
  autoFocus?: boolean
  'aria-label'?: string
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  maxLength?: number
}

export function Input(props: InputProps): JSX.Element {
  const { value, onChange, placeholder, type = 'text', disabled, error, prefix, suffix, className, style, autoFocus, onKeyDown, maxLength } = props
  const id = useId()
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <div
        className={cx(
          'flex items-center gap-1 rounded-[var(--wa-radius-md)] border bg-[var(--wa-panel)] px-2 h-9 wa-interactive',
          error ? 'border-[var(--wa-danger)]' : 'border-[var(--wa-border)] focus-within:border-[var(--wa-accent)] focus-within:shadow-[var(--wa-focus-ring)]'
        )}
        style={style}
      >
        {prefix && <span className="wa-muted text-sm">{prefix}</span>}
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-label={props['aria-label'] ?? placeholder}
          aria-invalid={error ? 'true' : 'false'}
          onKeyDown={onKeyDown}
          maxLength={maxLength}
          className="flex-1 bg-transparent text-sm text-[var(--wa-text)] placeholder:text-[color:var(--wa-muted)] outline-none disabled:cursor-not-allowed"
        />
        {suffix && <span className="wa-muted text-sm">{suffix}</span>}
      </div>
      {error && <span className="text-xs text-[var(--wa-danger)]">{error}</span>}
    </div>
  )
}

export interface TextareaProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  rows?: number
  className?: string
  style?: CSSProperties
  autoFocus?: boolean
  'aria-label'?: string
}

export function Textarea(props: TextareaProps): JSX.Element {
  const { value, onChange, placeholder, disabled, rows = 3, className, style, autoFocus } = props
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      autoFocus={autoFocus}
      aria-label={props['aria-label'] ?? placeholder}
      className={cx(
        'w-full rounded-[var(--wa-radius-md)] border bg-[var(--wa-panel)] px-2 py-1.5 text-sm',
        'border-[var(--wa-border)] focus:border-[var(--wa-accent)] focus:shadow-[var(--wa-focus-ring)] outline-none wa-interactive',
        'placeholder:text-[color:var(--wa-muted)] disabled:cursor-not-allowed',
        className
      )}
      style={style}
    />
  )
}

/* ============================================================
 * Card
 * ============================================================ */

export interface CardProps {
  children: ReactNode
  hoverable?: boolean
  selected?: boolean
  className?: string
  style?: CSSProperties
  onClick?: () => void
  padded?: boolean
}

export function Card(props: CardProps): JSX.Element {
  const { children, hoverable, selected, className, style, onClick, padded = true } = props
  return (
    <div
      onClick={onClick}
      style={style}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cx(
        'rounded-[var(--wa-radius-lg)] border bg-[var(--wa-panel)] shadow-[var(--wa-shadow-sm)] wa-interactive',
        selected ? 'border-[var(--wa-accent)] bg-[color-mix(in_srgb,var(--wa-accent)_8%,var(--wa-panel))]' : 'border-[var(--wa-border)]',
        hoverable && 'cursor-pointer hover:shadow-[var(--wa-shadow-md)]',
        padded && 'p-3',
        className
      )}
    >
      {children}
    </div>
  )
}

/* ============================================================
 * Modal
 * ============================================================ */

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  width?: number | string
  closeOnBackdrop?: boolean
  footer?: ReactNode
  className?: string
}

export function Modal(props: ModalProps): JSX.Element | null {
  const { open, onClose, title, children, width = 480, closeOnBackdrop = true, footer, className } = props
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 wa-modal-backdrop backdrop-blur-sm"
      onClick={() => closeOnBackdrop && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={ref}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => stopKey(e, onClose)}
        className={cx(
          'wa-modal rounded-[var(--wa-radius-lg)] bg-[var(--wa-panel)] shadow-[var(--wa-shadow-lg)] flex max-h-[90vh] flex-col',
          className
        )}
        style={{ width }}
      >
        {title && (
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--wa-border)' }}>
            <h2 className="m-0 text-base font-semibold">{title}</h2>
            <IconButton size="sm" variant="ghost" aria-label="关闭" onClick={onClose}>
              ✕
            </IconButton>
          </div>
        )}
        <div className="flex-1 overflow-auto px-4 py-3">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t px-4 py-2" style={{ borderColor: 'var(--wa-border)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================================================
 * Toast
 *  - 极简实现：渲染一个右上角浮层
 *  - 不阻塞交互；自动消失
 *  - 类型：info / success / warning / error
 * ============================================================ */

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: string
  kind: ToastKind
  message: string
  durationMs: number
}

let counter = 0
const listeners: Array<(items: ToastItem[]) => void> = []
let items: ToastItem[] = []

function emit(): void {
  for (const l of listeners) l(items)
}

export function pushToast(kind: ToastKind, message: string, durationMs = 2400): string {
  counter += 1
  const id = `t_${counter}`
  const it: ToastItem = { id, kind, message, durationMs }
  items = [...items, it]
  emit()
  if (durationMs > 0) {
    setTimeout(() => {
      items = items.filter((x) => x.id !== id)
      emit()
    }, durationMs)
  }
  return id
}

export function dismissToast(id: string): void {
  items = items.filter((x) => x.id !== id)
  emit()
}

export function ToastHost(): JSX.Element {
  const [list, setList] = useState<ToastItem[]>(items)
  useEffect(() => {
    const l = (next: ToastItem[]): void => setList(next)
    listeners.push(l)
    return () => {
      const i = listeners.indexOf(l)
      if (i >= 0) listeners.splice(i, 1)
    }
  }, [])
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-72 flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            'pointer-events-auto wa-slide-up flex items-start gap-2 rounded-[var(--wa-radius-md)] px-3 py-2 text-sm shadow-[var(--wa-shadow-md)]',
            t.kind === 'success' && 'bg-[color-mix(in_srgb,var(--wa-success)_14%,var(--wa-panel))] border border-[color-mix(in_srgb,var(--wa-success)_30%,transparent)] text-[color-mix(in_srgb,var(--wa-success)_85%,black)]',
            t.kind === 'warning' && 'bg-[color-mix(in_srgb,var(--wa-warning)_14%,var(--wa-panel))] border border-[color-mix(in_srgb,var(--wa-warning)_30%,transparent)] text-[color-mix(in_srgb,var(--wa-warning)_85%,black)]',
            t.kind === 'error' && 'bg-[color-mix(in_srgb,var(--wa-danger)_14%,var(--wa-panel))] border border-[color-mix(in_srgb,var(--wa-danger)_30%,transparent)] text-[color-mix(in_srgb,var(--wa-danger)_85%,black)]',
            t.kind === 'info' && 'bg-[var(--wa-panel)] border border-[var(--wa-border)] text-[var(--wa-text)]'
          )}
        >
          <span className="flex-1 break-words">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="关闭通知"
            className="wa-muted -m-1 rounded p-1 wa-interactive hover:bg-black/5"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

/* ============================================================
 * Badge
 * ============================================================ */

export interface BadgeProps {
  children: ReactNode
  kind?: 'default' | 'success' | 'warning' | 'danger' | 'accent' | 'info'
  pulse?: boolean
  className?: string
  style?: CSSProperties
}

export function Badge(props: BadgeProps): JSX.Element {
  const { children, kind = 'default', pulse = false, className, style } = props
  const cls: Record<NonNullable<BadgeProps['kind']>, string> = {
    default: 'bg-[color-mix(in_srgb,var(--wa-border)_60%,var(--wa-panel))] text-[var(--wa-text)]',
    success: 'bg-[color-mix(in_srgb,var(--wa-success)_18%,var(--wa-panel))] text-[color-mix(in_srgb,var(--wa-success)_85%,black)]',
    warning: 'bg-[color-mix(in_srgb,var(--wa-warning)_18%,var(--wa-panel))] text-[color-mix(in_srgb,var(--wa-warning)_85%,black)]',
    danger: 'bg-[color-mix(in_srgb,var(--wa-danger)_18%,var(--wa-panel))] text-[color-mix(in_srgb,var(--wa-danger)_85%,black)]',
    accent: 'bg-[color-mix(in_srgb,var(--wa-accent)_18%,var(--wa-panel))] text-[color-mix(in_srgb,var(--wa-accent)_85%,black)]',
    info: 'bg-[color-mix(in_srgb,var(--wa-accent)_10%,var(--wa-panel))] text-[var(--wa-text)]'
  }
  return (
    <span
      style={style}
      className={cx(
        'inline-flex items-center gap-1 rounded-[var(--wa-radius-full)] px-2 py-0.5 text-[10px] font-medium',
        cls[kind],
        pulse && kind === 'success' && 'wa-pulse',
        className
      )}
    >
      {children}
    </span>
  )
}

/* ============================================================
 * Tabs
 * ============================================================ */

export interface TabsProps<T extends string> {
  items: Array<{ id: T; label: ReactNode; badge?: ReactNode }>
  value: T
  onChange: (id: T) => void
  className?: string
  size?: 'sm' | 'md'
}

export function Tabs<T extends string>(props: TabsProps<T>): JSX.Element {
  const { items, value, onChange, className, size = 'md' } = props
  return (
    <div
      role="tablist"
      className={cx(
        'flex items-center gap-1 border-b',
        className
      )}
      style={{ borderColor: 'var(--wa-border)' }}
    >
      {items.map((it) => {
        const active = it.id === value
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.id)}
            className={cx(
              'relative wa-interactive',
              size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
              'rounded-t-[var(--wa-radius-md)]',
              active
                ? 'font-semibold text-[var(--wa-accent)] bg-[color-mix(in_srgb,var(--wa-accent)_8%,var(--wa-panel))]'
                : 'text-[var(--wa-text)] hover:bg-[color-mix(in_srgb,var(--wa-border)_30%,var(--wa-panel))]'
            )}
          >
            {it.label}
            {it.badge != null && <span className="ml-1.5">{it.badge}</span>}
            {active && (
              <span
                aria-hidden
                className="absolute bottom-[-1px] left-0 right-0 h-0.5 rounded-full bg-[var(--wa-accent)] wa-tab-content"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ============================================================
 * Tooltip
 *  - 300ms 延迟显示
 *  - 通过 hover/focus 触发
 * ============================================================ */

export interface TooltipProps {
  content: ReactNode
  children: ReactNode
  placement?: 'top' | 'bottom' | 'left' | 'right'
  delayMs?: number
}

export function Tooltip(props: TooltipProps): JSX.Element {
  const { content, children, placement = 'top', delayMs = 300 } = props
  const [show, setShow] = useState(false)
  const t = useRef<number | null>(null)
  const open = (): void => {
    if (t.current != null) window.clearTimeout(t.current)
    t.current = window.setTimeout(() => setShow(true), delayMs)
  }
  const close = (): void => {
    if (t.current != null) window.clearTimeout(t.current)
    t.current = null
    setShow(false)
  }
  const placementCls: Record<NonNullable<TooltipProps['placement']>, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5'
  }
  return (
    <span className="relative inline-flex" onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}>
      {children}
      {show && (
        <span
          role="tooltip"
          className={cx(
            'pointer-events-none absolute z-40 whitespace-nowrap rounded-[var(--wa-radius-sm)] bg-black/85 px-2 py-1 text-[11px] text-white shadow-[var(--wa-shadow-md)] wa-pop',
            placementCls[placement]
          )}
        >
          {content}
        </span>
      )}
    </span>
  )
}

/* ============================================================
 * EmptyState / LoadingState / ErrorState
 * ============================================================ */

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  className?: string
}

export function EmptyState(props: EmptyStateProps): JSX.Element {
  const { icon = '📭', title, description, action, className } = props
  return (
    <div className={cx('flex flex-col items-center justify-center gap-2 p-8 text-center', className)}>
      <div className="text-3xl" aria-hidden>{icon}</div>
      <h3 className="m-0 text-base font-semibold text-[var(--wa-text)]">{title}</h3>
      {description && <p className="m-0 max-w-md text-xs wa-muted">{description}</p>}
      {action && (
        <Button variant="primary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}

export interface LoadingStateProps {
  label?: string
  rows?: number
  className?: string
}

export function LoadingState(props: LoadingStateProps): JSX.Element {
  const { label = '加载中…', rows = 3, className } = props
  return (
    <div className={cx('flex flex-col gap-2 p-4', className)} aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2 text-xs wa-muted">
        <Spinner size="xs" />
        <span>{label}</span>
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-3 w-full rounded wa-pulse"
          style={{ background: 'color-mix(in srgb, var(--wa-border) 60%, transparent)', width: `${100 - i * 12}%` }}
        />
      ))}
    </div>
  )
}

export interface ErrorStateProps {
  title?: string
  description?: string
  onRetry?: () => void
  className?: string
}

export function ErrorState(props: ErrorStateProps): JSX.Element {
  const { title = '出错了', description, onRetry, className } = props
  return (
    <div className={cx('flex flex-col items-center justify-center gap-2 p-6 text-center', className)} role="alert">
      <div className="text-3xl" aria-hidden>⚠️</div>
      <h3 className="m-0 text-base font-semibold text-[var(--wa-danger)]">{title}</h3>
      {description && <p className="m-0 max-w-md text-xs wa-muted">{description}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  )
}

/* ============================================================
 * Spinner
 * ============================================================ */

export interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
  'aria-label'?: string
}

export function Spinner(props: SpinnerProps): JSX.Element {
  const { size = 'sm', className, 'aria-label': label = '加载中' } = props
  const dim = size === 'xs' ? 12 : size === 'sm' ? 16 : size === 'md' ? 24 : 32
  return (
    <svg
      width={dim}
      height={dim}
      viewBox="0 0 24 24"
      className={cx('wa-spin text-current', className)}
      role="status"
      aria-label={label}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}