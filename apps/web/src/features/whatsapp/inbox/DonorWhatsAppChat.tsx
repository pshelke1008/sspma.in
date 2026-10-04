import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatWindow } from './ChatWindow';

/**
 * The donor's WhatsApp conversation inside their profile (CAThrives'
 * per-lead WhatsAppChat): the same thread and reply box as the inbox.
 */
export function DonorWhatsAppChat({ phone }: { phone: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-[min(640px,calc(100dvh-12rem))] min-h-[440px] flex-col overflow-hidden rounded-card border border-line bg-[#efeae2] shadow-card">
      <ChatWindow
        phone={phone}
        embedded
        headerAction={
          <Button asChild variant="outline" size="sm">
            <Link to={`/whatsapp?phone=${phone}`}>
              <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{t('whatsappInbox.openInInbox')}</span>
              <span className="sr-only sm:hidden">{t('whatsappInbox.openInInbox')}</span>
            </Link>
          </Button>
        }
      />
    </div>
  );
}
