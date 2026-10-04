import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileText, Info, LayoutTemplate, Lock, Paperclip, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import type { WhatsAppProviderKey } from '@ashram/types';
import { errorMessage } from '@/i18n/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { bytes } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import type { WhatsAppNumber } from '../api';
import { sendMedia, sendMessage, useInboxTemplates, type Conversation, type InboxMessage } from './api';

const MAX_BODY = 4096;
const MAX_CAPTION = 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Why nothing can be sent right now, or null when the composer is usable. */
export type BlockReason = 'notConnected' | 'inactive' | 'notOptedIn' | 'unknownClosed' | null;

export function blockReason(conversation: Conversation | undefined, provider: WhatsAppProviderKey | null, providerKnown: boolean): BlockReason {
  if (providerKnown && !provider) return 'notConnected';
  if (!conversation) return null;
  if (conversation.donor && !conversation.donor.isActive) return 'inactive';
  if (!conversation.windowOpen && !conversation.donor?.whatsappOptIn) return conversation.donor ? 'notOptedIn' : 'unknownClosed';
  return null;
}

function numberLabel(number: WhatsAppNumber): string {
  return number.verifiedName || number.displayNumber || number.phoneNumberId;
}

/**
 * The reply box (CAThrives' MessageInput): free text inside the 24-hour
 * window, approved templates on the Cloud API (required once the window has
 * closed), photo/PDF attachments with a caption, and a "Send from" choice when
 * several business numbers are connected.
 */
export function MessageInput({
  phone,
  conversation,
  provider,
  providerKnown,
  numbers,
  onSent,
  autoFocus,
}: {
  phone: string;
  conversation: Conversation | undefined;
  provider: WhatsAppProviderKey | null;
  providerKnown: boolean;
  numbers: WhatsAppNumber[];
  onSent: (message: InboxMessage) => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateKey, setTemplateKey] = useState('');
  const [templateParams, setTemplateParams] = useState<string[]>([]);
  const [numberId, setNumberId] = useState<string | null>(null);

  const cloud = provider === 'CLOUD_API';
  const windowOpen = Boolean(conversation?.windowOpen);
  const reason = blockReason(conversation, provider, providerKnown);
  const blocked = !conversation || reason !== null;
  /** Meta only accepts an approved template once the window has closed. */
  const templateOnly = cloud && !windowOpen;
  const templateMode = cloud && (templateOnly || templateOpen);
  const canAttach = cloud && windowOpen && !blocked;
  const showNumberPicker = cloud && numbers.length > 1;

  // Default sender: the number this conversation last used, else the first one.
  const effectiveNumberId =
    numberId && numbers.some((number) => number.id === numberId)
      ? numberId
      : conversation?.numberId && numbers.some((number) => number.id === conversation.numberId)
        ? conversation.numberId
        : (numbers[0]?.id ?? null);

  const { data: templates, isLoading: templatesLoading } = useInboxTemplates(effectiveNumberId, templateMode && !blocked);
  const selectedTemplate = templates?.data.find((item) => `${item.name}|${item.language}` === templateKey);

  useEffect(() => {
    // Desktop only: on a phone the keyboard would cover the thread on open.
    if (autoFocus && !blocked && window.matchMedia('(min-width: 1024px)').matches) textareaRef.current?.focus();
  }, [autoFocus, blocked]);

  // Object URLs for the photo preview are released when replaced or unmounted.
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Keep the textarea as tall as its text, up to about six lines.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
  }, [text]);

  const sender = cloud ? effectiveNumberId : null;

  const mutation = useMutation({
    mutationFn: async () => {
      if (templateMode) {
        const [templateName, templateLanguage] = templateKey.split('|');
        return sendMessage(phone, { templateName, templateLanguage, templateParams, numberId: sender });
      }
      if (file) return sendMedia(phone, file, text.trim(), sender);
      return sendMessage(phone, { body: text.trim(), numberId: sender });
    },
    onSuccess: (result) => {
      if (templateMode) {
        setTemplateOpen(false);
        setTemplateKey('');
        setTemplateParams([]);
      } else {
        setText('');
        setFile(null);
      }
      onSent(result.data);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    onError: (error) => toast.error(t('whatsappInbox.sendFailed'), { description: errorMessage(t, error) }),
  });

  const templateReady = Boolean(selectedTemplate) && templateParams.every((param) => param.trim());
  const canSend = !blocked && !mutation.isPending && (templateMode ? templateReady : Boolean(text.trim()) || Boolean(file));

  function submit() {
    if (canSend) mutation.mutate();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function pickFile(next: File | undefined) {
    if (!next) return;
    if (!ACCEPTED.includes(next.type)) {
      toast.error(t('whatsappInbox.fileTypeInvalid'));
      return;
    }
    setFile(next);
    textareaRef.current?.focus();
  }

  if (reason) {
    return (
      <div className="border-t border-line bg-[#f0f2f5] px-4 py-3">
        <p className="flex items-start gap-2 rounded-control bg-white px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-muted" role="status">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t(`whatsappInbox.blocked.${reason}`)}
        </p>
      </div>
    );
  }

  const textLimit = file ? MAX_CAPTION : MAX_BODY;

  return (
    <div className="border-t border-line bg-[#f0f2f5] px-3 py-2.5">
      {showNumberPicker && (
        <div className="mb-2 flex items-center gap-2">
          <span className="shrink-0 text-[11.5px] font-medium text-ink-muted" aria-hidden="true">
            {t('whatsappInbox.sendFrom')}
          </span>
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <SimpleSelect
              value={effectiveNumberId ?? undefined}
              onValueChange={(value) => {
                setNumberId(value);
                setTemplateKey('');
                setTemplateParams([]);
              }}
              options={numbers.map((number) => ({
                value: number.id,
                label: numberLabel(number),
                hint: number.verifiedName && number.displayNumber ? number.displayNumber : undefined,
              }))}
              ariaLabel={t('whatsappInbox.sendFrom')}
              className="h-8 bg-white text-[12.5px]"
            />
          </div>
        </div>
      )}

      {templateMode && (
        <section
          aria-labelledby={`${id}-template-title`}
          className="mb-2 max-h-[45vh] overflow-y-auto rounded-control border border-line bg-white p-3 shadow-sm"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <h3 id={`${id}-template-title`} className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                <LayoutTemplate className="h-4 w-4 text-[#008069]" aria-hidden="true" />
                {t('whatsappInbox.templateTitle')}
              </h3>
              <p className="mt-0.5 text-[11.5px] text-ink-muted">
                {templateOnly ? t('whatsappInbox.templateRequired') : t('whatsappInbox.templateOptional')}
              </p>
            </div>
            {!templateOnly && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setTemplateOpen(false)}
                aria-label={t('whatsappInbox.closeTemplates')}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>

          <SimpleSelect
            value={templateKey || undefined}
            onValueChange={(key) => {
              const template = templates?.data.find((item) => `${item.name}|${item.language}` === key);
              setTemplateKey(key);
              setTemplateParams(Array(template?.bodyParameterCount ?? 0).fill(''));
            }}
            options={(templates?.data ?? []).map((item) => ({
              value: `${item.name}|${item.language}`,
              label: item.name,
              hint: item.language,
            }))}
            placeholder={templatesLoading ? t('common.loading') : t('whatsappInbox.chooseTemplate')}
            ariaLabel={t('whatsappInbox.chooseTemplate')}
          />
          {!templatesLoading && templates && templates.data.length === 0 && (
            <p className="mt-2 text-[11.5px] text-ink-muted">{t('whatsappInbox.noTemplates')}</p>
          )}

          {selectedTemplate && (
            <div className="mt-3 space-y-2">
              <blockquote className="whitespace-pre-wrap rounded-control border border-line bg-canvas/60 px-3 py-2 text-[12.5px] text-ink">
                {selectedTemplate.bodyText}
              </blockquote>
              {templateParams.map((param, index) => (
                <div key={index}>
                  <label htmlFor={`${id}-param-${index}`} className="mb-1 block text-[11.5px] font-medium text-ink">
                    {t('whatsappInbox.variable', { number: index + 1 })}
                  </label>
                  <Input
                    id={`${id}-param-${index}`}
                    value={param}
                    maxLength={1024}
                    placeholder={index === 0 ? '{{name}}' : undefined}
                    onChange={(event) => {
                      const next = [...templateParams];
                      next[index] = event.target.value;
                      setTemplateParams(next);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        submit();
                      }
                    }}
                  />
                </div>
              ))}
              {templateParams.length > 0 && <p className="text-[11px] text-ink-muted">{t('whatsappInbox.variableHint')}</p>}
              <div className="flex justify-end pt-1">
                <Button size="sm" onClick={submit} disabled={!canSend} loading={mutation.isPending} className="bg-[#008069] hover:bg-[#006d5b]">
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('whatsappInbox.sendTemplate')}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {file && !templateMode && (
        <div className="mb-2 flex items-center gap-3 rounded-control border border-line bg-white p-2">
          {preview ? (
            <img src={preview} alt={t('whatsappInbox.attachmentPreview', { name: file.name })} className="h-14 w-14 rounded object-cover" />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded bg-danger/10">
              <FileText className="h-6 w-6 text-danger" aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-ink">{file.name}</span>
            <span className="block text-[11px] text-ink-muted">
              {bytes(file.size)} · {t('whatsappInbox.captionHint')}
            </span>
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => setFile(null)} aria-label={t('whatsappInbox.removeAttachment')}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {!templateMode && (
        <form
          className="flex items-end gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {cloud && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-ink-muted hover:bg-black/5"
              onClick={() => setTemplateOpen(true)}
              aria-label={t('whatsappInbox.useTemplate')}
              title={t('whatsappInbox.useTemplate')}
            >
              <LayoutTemplate className="h-5 w-5" aria-hidden="true" />
            </Button>
          )}
          {cloud && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-ink-muted hover:bg-black/5"
                onClick={() => fileInputRef.current?.click()}
                disabled={!canAttach}
                aria-label={t('whatsappInbox.attach')}
                title={canAttach ? t('whatsappInbox.attach') : t('whatsappInbox.attachUnavailable')}
              >
                <Paperclip className="h-5 w-5" aria-hidden="true" />
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED.join(',')}
                className="hidden"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  pickFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </>
          )}
          <label htmlFor={`${id}-text`} className="sr-only">
            {file ? t('whatsappInbox.captionLabel') : t('whatsappInbox.messageLabel')}
          </label>
          <textarea
            ref={textareaRef}
            id={`${id}-text`}
            rows={1}
            value={text}
            maxLength={textLimit}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={file ? t('whatsappInbox.captionPlaceholder') : t('whatsappInbox.messagePlaceholder')}
            aria-describedby={`${id}-hint`}
            className={cn(
              'min-h-[40px] flex-1 resize-none rounded-[20px] border border-transparent bg-white px-4 py-2.5 text-[13.5px] leading-5 text-ink',
              'placeholder:text-ink-muted/70 focus:border-[#008069]/40 focus:outline-none focus:ring-2 focus:ring-[#008069]/30',
            )}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!canSend}
            loading={mutation.isPending}
            aria-label={t('whatsappInbox.send')}
            className="h-10 w-10 shrink-0 rounded-full bg-[#008069] text-white hover:bg-[#006d5b]"
          >
            {!mutation.isPending && <Send className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </form>
      )}

      <p id={`${id}-hint`} className="mt-1.5 flex items-center gap-1.5 px-1 text-[10.5px] text-ink-muted">
        <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
        {templateMode ? t('whatsappInbox.templateHint') : t('whatsappInbox.keyboardHint')}
      </p>
    </div>
  );
}
