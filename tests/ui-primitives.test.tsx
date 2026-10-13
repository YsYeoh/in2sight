import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

describe('shadcn primitives render and behave', () => {
  it('Button fires onClick, honours disabled, and exposes its slot for the density CSS', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toHaveAttribute('data-slot', 'button');
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a disabled Button does not fire', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>No</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('Input and Textarea are labelled controls', async () => {
    render(
      <div>
        <Label htmlFor="n">Name</Label>
        <Input id="n" />
        <Label htmlFor="t">Note</Label>
        <Textarea id="t" />
      </div>,
    );
    await userEvent.type(screen.getByLabelText('Name'), 'Brand');
    expect(screen.getByLabelText('Name')).toHaveValue('Brand');
    expect(screen.getByLabelText('Note').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Name')).toHaveAttribute('data-slot', 'input');
  });

  it('Checkbox and Switch toggle', async () => {
    render(
      <div>
        <Checkbox aria-label="reels" />
        <Switch aria-label="stories" />
      </div>,
    );
    const c = screen.getByRole('checkbox', { name: 'reels' });
    const s = screen.getByRole('switch', { name: 'stories' });
    await userEvent.click(c);
    await userEvent.click(s);
    expect(c).toBeChecked();
    expect(s).toBeChecked();
  });

  it('Tabs switch panels', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">One</TabsTrigger>
          <TabsTrigger value="b">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="a">first</TabsContent>
        <TabsContent value="b">second</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('first')).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'Two' }));
    expect(screen.getByText('second')).toBeVisible();
  });

  it('Card, Badge, Alert, Progress and Table render their content with the right roles', () => {
    render(
      <div>
        <Card>
          <CardHeader>
            <CardTitle>Title</CardTitle>
          </CardHeader>
          <CardContent>Body</CardContent>
        </Card>
        <Badge>Active</Badge>
        <Alert>
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>Detail</AlertDescription>
        </Alert>
        <Progress value={40} aria-label="sync" />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>@brand</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>,
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Heads up');
    expect(screen.getByRole('progressbar', { name: 'sync' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '@brand' })).toBeInTheDocument();
  });
});
