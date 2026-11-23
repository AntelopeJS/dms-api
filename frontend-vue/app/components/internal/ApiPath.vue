<script setup lang="ts">
import { computed } from 'vue'
import { pathSegments } from '../../utils/http'

/** A route path with its `:params` highlighted; `prefix` dims the folder it sits in. */
const props = withDefaults(
  defineProps<{
    path: string
    prefix?: string
  }>(),
  { prefix: '' },
)

const dimmed = computed(() =>
  props.prefix &&
  props.path.startsWith(props.prefix) &&
  props.path !== props.prefix
    ? props.prefix
    : '',
)
const rest = computed(() => pathSegments(props.path.slice(dimmed.value.length)))
</script>

<template>
  <span class="min-w-0 truncate font-mono" :title="path">
    <span v-if="dimmed" class="text-dimmed">{{ dimmed }}</span>
    <template v-for="(segment, index) in rest" :key="index">
      <span v-if="segment.param" class="text-primary">{{ segment.text }}</span>
      <template v-else>{{ segment.text }}</template>
    </template>
  </span>
</template>
