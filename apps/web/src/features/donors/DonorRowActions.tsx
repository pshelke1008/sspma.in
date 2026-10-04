import { useTranslation } from 'react-i18next';
import { Eye, HeartHandshake, MessageCircle, MoreHorizontal, Pencil, RotateCcw, Trash2, UserX } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthProvider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DonorRow } from './types';

export type DonorAction = 'view' | 'edit' | 'donation' | 'message' | 'deactivate' | 'restore' | 'delete';

/**
 * The per-row menu on the donor list. Every click is stopped here: the row
 * itself opens the profile, and React bubbles events out of the menu's portal
 * back through the row.
 */
export function DonorRowActions({ donor, onAction }: { donor: DonorRow; onAction: (action: DonorAction, donor: DonorRow) => void }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const hasDonations = donor.stats.donationCount > 0;

  const item = (action: DonorAction) => (event: Event) => {
    event.stopPropagation();
    onAction(action, donor);
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50 data-[state=open]:bg-canvas data-[state=open]:text-ink"
          aria-label={t('donors.actionsFor', { name: donor.name })}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={item('view')}>
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          {t('donors.viewProfile')}
        </DropdownMenuItem>
        {can('donor.manage') && (
          <DropdownMenuItem onSelect={item('edit')}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            {t('common.edit')}
          </DropdownMenuItem>
        )}
        {can('donation.create') && donor.isActive && (
          <DropdownMenuItem onSelect={item('donation')}>
            <HeartHandshake className="h-3.5 w-3.5" aria-hidden="true" />
            {t('donors.recordDonation')}
          </DropdownMenuItem>
        )}
        {can('whatsapp.send') && (
          <DropdownMenuItem onSelect={item('message')} disabled={!donor.messaging.canMessage}>
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {t('donors.sendWhatsApp')}
          </DropdownMenuItem>
        )}
        {(can('donor.manage') || can('donor.delete')) && <DropdownMenuSeparator />}
        {can('donor.manage') &&
          (donor.isActive ? (
            <DropdownMenuItem onSelect={item('deactivate')}>
              <UserX className="h-3.5 w-3.5" aria-hidden="true" />
              {t('donors.deactivate')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={item('restore')}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t('donors.restore')}
            </DropdownMenuItem>
          ))}
        {can('donor.delete') && (
          <DropdownMenuItem
            tone="danger"
            onSelect={item('delete')}
            disabled={hasDonations}
            title={hasDonations ? t('donors.deleteBlocked', { count: donor.stats.donationCount }) : undefined}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('donors.delete')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
