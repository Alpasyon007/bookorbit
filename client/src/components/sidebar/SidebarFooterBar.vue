<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleArrowUp } from '@lucide/vue'
import { SidebarFooter } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buildSidebarVersionUi } from '@/components/sidebar/versionUi'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import { useWhatsNew } from '@/features/whats-new/composables/useWhatsNew'

const emit = defineEmits<{ navigate: [] }>()

const { t } = useI18n()
const { version, updateAvailable, latestVersion } = useAppInfo()
const { hasUnseen: hasUnseenWhatsNew } = useWhatsNew()

const versionUi = computed(() => buildSidebarVersionUi(version.value, updateAvailable.value, latestVersion.value))

function handleNavigate() {
  emit('navigate')
}
</script>

<template>
  <SidebarFooter
    v-if="versionUi.currentLabel || versionUi.showUpdate"
    class="border-t border-sidebar-border px-4 py-1 group-data-[collapsible=icon]:hidden"
  >
    <div class="flex min-h-[26px] min-w-0 items-center justify-center gap-1">
      <RouterLink
        v-if="versionUi.currentLabel"
        to="/whats-new"
        class="inline-flex min-w-0 items-center gap-1.5 rounded-md text-[12.5px] font-medium text-muted-foreground outline-hidden transition-colors duration-150 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        @click="handleNavigate"
      >
        <span class="truncate">{{ versionUi.currentLabel }}</span>
        <span v-if="hasUnseenWhatsNew" class="h-1.5 w-1.5 flex-none rounded-full bg-primary" :aria-label="t('components.sidebar.newReleaseNotes')" />
      </RouterLink>

      <Tooltip v-if="versionUi.showUpdate">
        <TooltipTrigger as-child>
          <a
            :href="versionUi.updateHref"
            target="_blank"
            rel="noopener noreferrer"
            :aria-label="t('components.sidebar.openUpdateRelease', { version: versionUi.updateVersionLabel })"
            class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-success outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <CircleArrowUp :size="18" aria-hidden="true" />
          </a>
        </TooltipTrigger>
        <TooltipContent side="top">{{ t('components.sidebar.updateTooltip', { version: versionUi.updateVersionLabel }) }}</TooltipContent>
      </Tooltip>
    </div>
  </SidebarFooter>
</template>
