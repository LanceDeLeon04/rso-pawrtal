import { ShieldCheck } from 'lucide-react'
import PagePlaceholder from '../components/PagePlaceholder'

export default function Clearance() {
  return (
    <PagePlaceholder
      icon={ShieldCheck}
      title="Clearance"
      description="Every event requires complete post-event reports before an org may submit a new event."
      comingNext={[
        'Per-org clearance status (cleared / pending reports)',
        'Admins can extend report submission deadlines',
        'Admins can approve clearance',
      ]}
    />
  )
}
