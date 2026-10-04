import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Bell, CheckCheck, ChevronDown, LogOut, Menu, Search, Settings, User } from 'lucide-react';
import { api } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useNotifications } from '@/lib/api/hooks';
import { Avatar } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { relativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { GlobalSearch } from './GlobalSearch';
import { useTranslation } from 'react-i18next';
import { useLabels } from '@/i18n/useLabels';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

export function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { t } = useTranslation();
  const labels = useLabels();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const roleName = user ? (labels.roles[user.role.key] ?? user.role.name) : '';

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="sticky top-0 z-20 flex h-[58px] shrink-0 items-center gap-2 border-b border-line bg-white/95 px-3 backdrop-blur sm:px-4 lg:h-16">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMenu} aria-label={t('nav.openMenu')}>
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Button>

      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className={cn(
          'hidden h-9 flex-1 items-center gap-2 rounded-control border border-line bg-canvas/70 px-3 text-left text-[13px] text-ink-muted transition-colors',
          'hover:bg-canvas focus-visible:ring-2 focus-visible:ring-brand-primary/50 sm:flex sm:max-w-sm',
        )}
      >
        <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate">{t('header.searchPlaceholder')}</span>
        <kbd className="hidden rounded border border-line bg-white px-1.5 py-0.5 text-[10px] font-medium text-ink-muted md:inline">
          /
        </kbd>
      </button>

      <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setSearchOpen(true)} aria-label={t('search.title')}>
        <Search className="h-[18px] w-[18px]" aria-hidden="true" />
      </Button>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <LanguageSwitcher signedIn className="hidden md:inline-flex" />
        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-control px-1.5 py-1 transition-colors hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
              aria-label={t('header.openUserMenu')}
            >
              <Avatar name={user?.name ?? '?'} src={user?.avatarUrl} />
              <span className="hidden min-w-0 text-left sm:block">
                <span className="block truncate text-[12.5px] font-medium leading-tight text-ink">{user?.name}</span>
                <span className="block truncate text-[11px] leading-tight text-ink-muted">{roleName}</span>
              </span>
              <ChevronDown className="hidden h-3.5 w-3.5 text-ink-muted sm:block" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuLabel>
              <span className="block truncate text-[12.5px] font-semibold normal-case tracking-normal text-ink">
                {user?.name}
              </span>
              <span className="block truncate text-[11px] font-normal normal-case tracking-normal text-ink-muted">
                {user?.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings/profile">
                <User className="h-3.5 w-3.5" aria-hidden="true" />
                {t('common.myProfile')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                {t('common.settings')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem tone="danger" onSelect={() => void handleLogout()}>
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              {t('common.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}

function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data } = useNotifications();
  const navigate = useNavigate();

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  });

  const unread = data?.unreadCount ?? 0;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={unread > 0 ? t('header.notificationsUnread', { count: unread }) : t('header.notifications')}
        className="relative"
      >
        <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-danger px-0.5 text-[9.5px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" width="sm:max-w-sm">
          <SheetHeader>
            <div className="flex items-center justify-between gap-2">
              <SheetTitle className="text-[15px] font-semibold text-ink">{t('header.notifications')}</SheetTitle>
              {unread > 0 && (
                <Button variant="ghost" size="sm" onClick={() => markAllRead.mutate()} loading={markAllRead.isPending}>
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('header.markAllRead')}
                </Button>
              )}
            </div>
          </SheetHeader>
          <SheetBody className="px-0">
            {!data?.data.length ? (
              <p className="px-5 py-10 text-center text-[12.5px] text-ink-muted">{t('header.noNotifications')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.data.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!item.isRead) markRead.mutate(item.id);
                        if (item.link) {
                          setOpen(false);
                          navigate(item.link);
                        }
                      }}
                      className={cn(
                        'flex w-full gap-3 px-5 py-3 text-left transition-colors hover:bg-canvas',
                        !item.isRead && 'bg-brand-light/40',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                          item.isRead ? 'bg-transparent' : 'bg-accent',
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-medium text-ink">{item.title}</span>
                        <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-muted">{item.message}</span>
                        <span className="mt-1 block text-[11px] text-ink-muted">{relativeTime(item.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
