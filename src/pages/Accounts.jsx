import { Users } from 'lucide-react'
import PagePlaceholder from '../components/PagePlaceholder'

export default function Accounts() {
  return (
    <PagePlaceholder
      icon={Users}
      title="Accounts"
      description="System Admins and other admin roles create accounts and set viewer access here."
      comingNext={[
        'Create RSO Officer, admin-tier, and viewer-scoped accounts',
        'Group RSO Officers by org, and by cross-org tags (e.g. all Treasurers)',
        'Assign admin viewer scopes (events, calendar, approvals, etc.)',
      ]}
    />
  )
}
