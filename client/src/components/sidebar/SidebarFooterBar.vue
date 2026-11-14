<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleArrowUp, Heart } from '@lucide/vue'
import { SidebarFooter } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buildSidebarVersionUi } from '@/components/sidebar/versionUi'
import SidebarGithubStar from '@/components/sidebar/SidebarGithubStar.vue'
import SidebarAppLinks from '@/components/sidebar/SidebarAppLinks.vue'
import { useCustomPatchSettings } from '@/features/custom-patches/composables/useCustomPatchSettings'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import { useWhatsNew } from '@/features/whats-new/composables/useWhatsNew'

withDefaults(defineProps<{ isRail?: boolean }>(), { isRail: false })

const emit = defineEmits<{ navigate: [] }>()

const { t } = useI18n()
const { version, updateAvailable, latestVersion } = useAppInfo()
const { hasUnseen: hasUnseenWhatsNew } = useWhatsNew()
const { preferences, policy, loaded } = useCustomPatchSettings()
const sidebar = computed(() => {
  if (!loaded.value) return { showGithub: false, showSupport: false, showIos: false, showAndroid: false }
  if (!policy.value.sidebarCustomizationEnabled || !preferences.value.sidebar.enabled) {
    return { showGithub: true, showSupport: true, showIos: true, showAndroid: true }
  }
  return preferences.value.sidebar
})
const hasPromotions = computed(() => sidebar.value.showGithub || sidebar.value.showSupport || sidebar.value.showIos || sidebar.value.showAndroid)

const versionUi = computed(() => buildSidebarVersionUi(version.value, updateAvailable.value, latestVersion.value))

function handleNavigate() {
  emit('navigate')
}
</script>

<template>
  <SidebarFooter
    v-if="versionUi.currentLabel || versionUi.showUpdate || hasPromotions"
    class="border-t border-sidebar-border px-4 py-1"
    :class="hasPromotions ? 'group-data-[collapsible=icon]:px-2' : 'group-data-[collapsible=icon]:hidden'"
  >
    <div class="flex min-h-[26px] min-w-0 items-center justify-center gap-1 group-data-[collapsible=icon]:hidden">
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
    <div v-if="hasPromotions" class="flex flex-wrap items-center justify-center gap-1 group-data-[collapsible=icon]:flex-col">
      <SidebarGithubStar v-if="sidebar.showGithub" :is-rail="isRail" />
      <Tooltip v-if="sidebar.showSupport">
        <TooltipTrigger as-child>
          <a
            href="https://ko-fi.com/neonbookorbit"
            target="_blank"
            rel="noopener noreferrer"
            :aria-label="t('components.sidebar.supportAria')"
            class="inline-flex size-[26px] shrink-0 items-center justify-center rounded-md text-destructive outline-hidden transition-colors hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <Heart :size="15" class="fill-current" aria-hidden="true" />
          </a>
        </TooltipTrigger>
        <TooltipContent :side="isRail ? 'right' : 'top'">{{ t('components.sidebar.support') }}</TooltipContent>
      </Tooltip>
      <SidebarAppLinks
        v-if="sidebar.showIos || sidebar.showAndroid"
        :is-rail="isRail"
        :show-ios="sidebar.showIos"
        :show-android="sidebar.showAndroid"
      />
    </div>
  </SidebarFooter>
</template>
