'use client';

import { Plus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { EmptyState } from '@/components/shared/EmptyState';
import { FormField } from '@/components/shared/FormField';
import { InsightOrb } from '@/components/shared/InsightOrb';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/shared/ResponsiveDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { formatDelta, formatNumber } from '@/lib/format';

const VARIANTS = ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

export function Gallery() {
  const t = useTranslations('styleguide.gallery');
  const tl = useTranslations('loading');
  const { prefs } = usePrefs();
  const rows: [string, number, number][] = [
    [t('reach'), 184200, 0.032],
    [t('impressions'), 512340, -0.011],
    [t('followers'), 12873, 0.048],
  ];

  return (
    <div className="grid gap-[var(--gp)] md:grid-cols-2">
      <Group title={t('buttons')}>
        {VARIANTS.map((variant) => (
          <div key={variant} className="flex flex-wrap items-center gap-2">
            <code className="w-24 text-xs text-muted-foreground">{variant}</code>
            <Button variant={variant}>{t('normal')}</Button>
            <Button variant={variant} size="sm">{t('small')}</Button>
            <Button variant={variant} size="icon" aria-label={t('connect')}><Plus /></Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <code className="w-24 text-xs text-muted-foreground">disabled</code>
          <Button disabled>{t('disabled')}</Button>
        </div>
      </Group>

      <Group title={t('inputs')}>
        <FormField id="g-name" label={t('sampleName')}>{(p) => <Input {...p} defaultValue="Yong Sen" />}</FormField>
        <FormField id="g-hint" label={t('sampleName')} hint={t('hint')}>{(p) => <Input {...p} />}</FormField>
        <FormField id="g-email" label={t('sampleEmail')} error={t('invalidEmail')} required>
          {(p) => <Input {...p} type="email" defaultValue="not-an-email" />}
        </FormField>
        <FormField id="g-msg" label={t('message')}>{(p) => <Textarea {...p} />}</FormField>
      </Group>

      <Group title={t('select')}>
        <FormField id="g-type" label={t('accountType')}>
          {({ id }) => (
            <Select defaultValue="business">
              <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="business">{t('business')}</SelectItem>
                <SelectItem value="creator">{t('creator')}</SelectItem>
                <SelectItem value="personal">{t('personal')}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </FormField>
      </Group>

      <Group title={t('choices')}>
        <div className="flex items-center gap-2">
          <Checkbox id="g-remember" defaultChecked />
          <Label htmlFor="g-remember">{t('remember')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="g-notify" defaultChecked />
          <Label htmlFor="g-notify">{t('notifications')}</Label>
        </div>
        <RadioGroup defaultValue="daily" aria-label={t('notifications')}>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="daily" id="g-daily" />
            <Label htmlFor="g-daily">{t('daily')}</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="weekly" id="g-weekly" />
            <Label htmlFor="g-weekly">{t('weekly')}</Label>
          </div>
        </RadioGroup>
      </Group>

      <Group title={t('tabs')}>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">{t('overview')}</TabsTrigger>
            <TabsTrigger value="audience">{t('audience')}</TabsTrigger>
            <TabsTrigger value="content">{t('content')}</TabsTrigger>
          </TabsList>
          {['overview', 'audience', 'content'].map((v) => (
            <TabsContent key={v} value={v} className="pt-2 text-muted-foreground">{t('tabText')}</TabsContent>
          ))}
        </Tabs>
      </Group>

      <Group title={t('feedback')}>
        <div className="flex flex-wrap gap-2">
          <Badge>{t('new')}</Badge>
          <Badge variant="secondary">{t('stable')}</Badge>
          <Badge variant="outline">{t('outline')}</Badge>
          <Badge variant="destructive">{t('error')}</Badge>
        </div>
        <Alert>
          <AlertTitle>{t('alertTitle')}</AlertTitle>
          <AlertDescription>{t('alertBody')}</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTitle>{t('errorTitle')}</AlertTitle>
          <AlertDescription>{t('errorBody')}</AlertDescription>
        </Alert>
      </Group>

      <Group title={t('dialogs')}>
        <div className="flex flex-wrap gap-2">
          <ResponsiveDialog>
            <ResponsiveDialogTrigger asChild><Button variant="outline">{t('openDialog')}</Button></ResponsiveDialogTrigger>
            <ResponsiveDialogContent>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>{t('dialogTitle')}</ResponsiveDialogTitle>
                <ResponsiveDialogDescription>{t('dialogBody')}</ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <ResponsiveDialogFooter>
                <ResponsiveDialogClose asChild><Button variant="outline">{t('cancel')}</Button></ResponsiveDialogClose>
                <ResponsiveDialogClose asChild><Button>{t('continue')}</Button></ResponsiveDialogClose>
              </ResponsiveDialogFooter>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="destructive">{t('delete')}</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('deleteBody')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                <AlertDialogAction>{t('confirm')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </Group>

      <Group title={t('table')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('metric')}</TableHead>
              <TableHead className="text-right">{t('value')}</TableHead>
              <TableHead className="text-right">{t('change')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([name, value, delta]) => (
              <TableRow key={name}>
                <TableCell>{name}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(value, prefs)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatDelta(delta, prefs)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Group>

      <Group title={t('empty')}>
        <EmptyState
          icon={<Users className="size-5" />}
          title={t('noAccounts')}
          description={t('noAccountsHint')}
          action={<Button size="sm">{t('connect')}</Button>}
        />
      </Group>

      <Group title={t('toast')}>
        <div>
          <Button variant="secondary" onClick={() => toast(t('toastText'))}>{t('showToast')}</Button>
        </div>
      </Group>

      <Group title={t('loading')}>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Progress value={60} aria-label={t('loading')} />
      </Group>

      <Group title={tl('gallery')}>
        <div className="flex flex-wrap items-end gap-6">
          {(['xs', 'md', 'lg'] as const).map((size) => (
            <div key={size} className="flex flex-col items-center gap-2">
              <InsightOrb size={size} label={tl('size', { size })} />
              <span className="text-xs text-muted-foreground">{tl('size', { size })}</span>
            </div>
          ))}
          <InsightOrb size="lg" captions />
        </div>
      </Group>
    </div>
  );
}
