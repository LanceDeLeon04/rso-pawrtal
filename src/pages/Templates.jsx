import { FileText } from 'lucide-react'
import PagePlaceholder from '../components/PagePlaceholder'

export default function Templates() {
  return (
    <PagePlaceholder
      icon={FileText}
      title="Templates"
      description="Download official SDAO templates for events and reports."
      comingNext={[
        'ACP Form and Attachments Template',
        'PARF Template',
        'Liquidation, Narrative, and Evaluation Report templates',
      ]}
    />
  )
}
