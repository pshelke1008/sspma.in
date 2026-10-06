import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, CalendarClock, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { errorMessage } from '@/i18n/errors';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { FormStepper, type Step } from '@/components/common/forms';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils/format';
import { sendingProvider, useWhatsAppStatus, type Broadcast } from '../api';
import { AudienceStep } from './AudienceStep';
import { CampaignStep } from './CampaignStep';
import { ReviewStep, scheduleError } from './ReviewStep';
import { VariablesStep, mappingError } from './VariablesStep';
import { EMPTY_WIZARD, MAX_RECIPIENTS, buildRequest, templateKeyOf, useCampaignTemplates, type WizardState } from './api';

type StepId = 'campaign' | 'audience' | 'variables' | 'review';

const defaultName = (date: string) => `Broadcast · ${date}`;

/**
 * Template broadcast, step by step: choose the template, choose who gets it,
 * say where each variable's value comes from, review, then send now or later.
 * Nothing is sent until the last step; each step explains what is missing.
 */
export default function BroadcastWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: status } = useWhatsAppStatus();
  const hasCloud = Boolean(status?.cloud.status === 'CONNECTED' && status.cloud.numbers?.length);
  const { data: templateData, isLoading: templatesLoading } = useCampaignTemplates(hasCloud);
  const templates = useMemo(() => templateData?.data ?? [], [templateData]);

  const [state, setState] = useState<WizardState>(() => ({ ...EMPTY_WIZARD, name: defaultName(formatDate(new Date(), 'medium')) }));
  const [index, setIndex] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const patch = (next: Partial<WizardState>) => setState((current) => ({ ...current, ...next }));

  const template = templates.find((item) => templateKeyOf(item) === state.templateKey);
  const needsVariables = (template?.bodyParameterCount ?? 0) > 0;
  const steps: (Step & { id: StepId })[] = [
    { id: 'campaign', label: t('whatsapp.campaign.steps.campaign') },
    { id: 'audience', label: t('whatsapp.campaign.steps.audience') },
    ...(needsVariables ? [{ id: 'variables' as const, label: t('whatsapp.campaign.steps.variables') }] : []),
    { id: 'review', label: t('whatsapp.campaign.steps.review') },
  ];
  const current = steps[Math.min(index, steps.length - 1)].id;

  // A template that is no longer on the list (deleted, or Meta paused it) is dropped.
  useEffect(() => {
    if (state.templateKey && !templatesLoading && templateData && !template) patch({ templateKey: '', mapping: {}, headerMedia: null });
  }, [state.templateKey, templatesLoading, templateData, template]);

  const errors = {
    name: state.name.trim().length < 2 ? 'whatsapp.nameRequired' : undefined,
    template: !template ? 'whatsapp.chooseTemplate' : undefined,
    media: template?.requiresHeaderMedia && !state.headerMedia ? 'whatsapp.campaign.errors.media' : undefined,
    audience:
      state.audience === null
        ? 'whatsapp.campaign.errors.choose'
        : state.audience === 'UPLOAD'
        ? !state.upload?.stats.matched
          ? 'whatsapp.campaign.errors.upload'
          : undefined
        : state.donorIds.length === 0
          ? state.audience === 'FILTER'
            ? 'whatsapp.campaign.errors.filter'
            : 'whatsapp.campaign.errors.audience'
          : state.donorIds.length > MAX_RECIPIENTS
            ? 'whatsapp.campaign.tooMany'
            : undefined,
    variables: template ? mappingError(template.bodyParameterCount, state.mapping, state.audience === 'UPLOAD') : undefined,
    schedule: scheduleError(state.schedule),
  };
  const blocked: Record<StepId, string | undefined> = {
    campaign: errors.name ?? errors.template ?? errors.media,
    audience: errors.audience,
    variables: errors.variables,
    review: errors.schedule,
  };

  const submit = useMutation({
    mutationFn: () =>
      api.post<{ data: Broadcast }>('/whatsapp/campaigns', {
        name: state.name.trim(),
        scheduledAt: state.schedule.mode === 'later' ? new Date(state.schedule.at).toISOString() : null,
        ...buildRequest(state, template!),
      }),
    onSuccess: ({ data }) => {
      void queryClient.invalidateQueries({ queryKey: ['whatsapp'] });
      toast.success(t(data.status === 'SCHEDULED' ? 'whatsapp.campaign.scheduled' : 'whatsapp.campaign.started'));
      navigate(`/whatsapp/broadcasts/${data.id}`);
    },
    onError: (error) => toast.error(t('whatsapp.campaign.createFailed'), { description: errorMessage(t, error) }),
  });

  function next() {
    if (blocked[current]) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    const target = Math.min(index + 1, steps.length - 1);
    setIndex(target);
    setFurthest((value) => Math.max(value, target));
  }

  const last = index >= steps.length - 1;
  const later = state.schedule.mode === 'later';

  return (
    <>
      <PageHeader
        title={t('whatsapp.campaign.title')}
        subtitle={t('whatsapp.campaign.subtitle')}
        breadcrumbs={[{ label: t('whatsapp.campaign.listTitle'), to: '/whatsapp/broadcasts' }, { label: t('whatsapp.campaign.newBroadcast') }]}
      />

      <SectionCard>
        <div className="space-y-5">
          {hasCloud && (
            <FormStepper
              steps={steps}
              current={index}
              furthest={furthest}
              onStepClick={(target) => {
                setShowErrors(false);
                setIndex(target);
              }}
            />
          )}

          {current === 'campaign' && (
            <CampaignStep
              state={state}
              onChange={patch}
              templates={templates}
              hidden={templateData?.hidden ?? 0}
              loading={templatesLoading}
              hasCloud={hasCloud}
              errors={showErrors ? errors : {}}
            />
          )}
          {current === 'audience' && (
            <AudienceStep
              state={state}
              onChange={patch}
              variableCount={template?.bodyParameterCount ?? 0}
              error={showErrors ? errors.audience : undefined}
            />
          )}
          {current === 'variables' && template && (
            <VariablesStep state={state} template={template} onChange={(mapping) => patch({ mapping })} error={showErrors ? errors.variables : undefined} />
          )}
          {current === 'review' && template && (
            <ReviewStep state={state} request={buildRequest(state, template)} onSchedule={(schedule) => patch({ schedule })} />
          )}

          {hasCloud && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => (index === 0 ? navigate('/whatsapp/broadcasts') : (setShowErrors(false), setIndex(index - 1)))}
                disabled={submit.isPending}
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                {index === 0 ? t('common.cancel') : t('common.back')}
              </Button>
              {last ? (
                <Button
                  type="button"
                  onClick={() => (errors.schedule ? setShowErrors(true) : submit.mutate())}
                  loading={submit.isPending}
                  disabled={!sendingProvider(status)}
                >
                  {later ? <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
                  {later ? t('whatsapp.campaign.schedule') : t('whatsapp.campaign.sendNowButton')}
                </Button>
              ) : (
                <Button type="button" onClick={next}>
                  {t('common.next')}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
          )}
        </div>
      </SectionCard>
    </>
  );
}
