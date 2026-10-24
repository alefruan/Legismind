import { createBrowserRouter, Navigate } from 'react-router'
import { AppShell } from '@/components/layout/app-shell'
import { FullPageLoader } from '@/components/common/states'
import { RequireAuth, RequireOrgAdmin, RequirePlatformAdmin, RequireWorkspace } from '@/features/auth/guards'
import { LoginPage } from '@/features/auth/login-page'
import { ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/password-pages'
import { AcceptInvitePage, OnboardingPage, SelectOrganizationPage } from '@/features/auth/invitation-pages'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { NotFoundPage } from '@/features/settings/profile-page'

/** Carrega o módulo da rota sob demanda (divisão de código por funcionalidade). */
function page<M>(load: () => Promise<M>, pick: (m: M) => React.ComponentType) {
  return { lazy: async () => ({ Component: pick(await load()) }), hydrateFallbackElement: <FullPageLoader /> }
}

const admin = () => import('@/features/admin/settings-pages')

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/recuperar-senha', element: <ForgotPasswordPage /> },
  { path: '/redefinir-senha', element: <ResetPasswordPage /> },
  { path: '/convite', element: <AcceptInvitePage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/selecionar-instituicao', element: <SelectOrganizationPage /> },
      { path: '/configurar-perfil', element: <OnboardingPage /> },
      {
        element: <AppShell />,
        children: [
          {
            element: <RequirePlatformAdmin />,
            children: [{ path: '/plataforma', ...page(() => import('@/features/platform/platform-page'), (m) => m.PlatformPage) }],
          },
          { path: '/perfil', ...page(() => import('@/features/settings/profile-page'), (m) => m.ProfilePage) },
          {
            element: <RequireWorkspace />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: '/assistente', ...page(() => import('@/features/assistant/assistant-page'), (m) => m.AssistantPage) },
              { path: '/assistente/:conversationId', ...page(() => import('@/features/assistant/assistant-page'), (m) => m.AssistantPage) },
              { path: '/emendas', ...page(() => import('@/features/amendments/list-page'), (m) => m.AmendmentsListPage) },
              { path: '/emendas/nova', ...page(() => import('@/features/amendments/new-page'), (m) => m.NewAmendmentPage) },
              { path: '/emendas/:id', ...page(() => import('@/features/amendments/editor/editor-page'), (m) => m.AmendmentEditorPage) },
              { path: '/orcamento', ...page(() => import('@/features/budget/explorer-page'), (m) => m.BudgetExplorerPage) },
              { path: '/base', ...page(() => import('@/features/documents/documents-page'), (m) => m.DocumentsPage) },
              { path: '/base/conferencia', ...page(() => import('@/features/documents/review-queue-page'), (m) => m.ReviewQueuePage) },
              { path: '/base/:id', ...page(() => import('@/features/documents/document-detail-page'), (m) => m.DocumentDetailPage) },
              { path: '/redator', ...page(() => import('@/features/modules/modules-pages'), (m) => m.DrafterPage) },
              { path: '/consultor', ...page(() => import('@/features/modules/modules-pages'), (m) => m.LegalAdvisorPage) },
              { path: '/gabinete', ...page(() => import('@/features/modules/modules-pages'), (m) => m.OfficeManagementPage) },
              {
                path: '/admin',
                element: <RequireOrgAdmin />,
                children: [
                  {
                    ...page(() => import('@/features/admin/admin-layout'), (m) => m.AdminLayout),
                    children: [
                      { index: true, element: <Navigate to="usuarios" replace /> },
                      { path: 'usuarios', ...page(() => import('@/features/admin/users-page'), (m) => m.UsersPage) },
                      { path: 'gabinetes', ...page(() => import('@/features/admin/offices-years-pages'), (m) => m.OfficesPage) },
                      { path: 'exercicios', ...page(() => import('@/features/admin/offices-years-pages'), (m) => m.FiscalYearsPage) },
                      { path: 'regras', ...page(() => import('@/features/admin/rules-page'), (m) => m.RulesPage) },
                      { path: 'modalidades', ...page(admin, (m) => m.ModalitiesPage) },
                      { path: 'modelos', ...page(admin, (m) => m.TemplatesPage) },
                      { path: 'configuracoes', ...page(admin, (m) => m.SettingsPage) },
                      { path: 'uso', ...page(admin, (m) => m.UsagePage) },
                      { path: 'auditoria', ...page(admin, (m) => m.AuditPage) },
                    ],
                  },
                ],
              },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
