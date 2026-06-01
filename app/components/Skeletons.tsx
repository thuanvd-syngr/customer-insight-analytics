import {
  BlockStack,
  Card,
  InlineGrid,
  Layout,
  SkeletonBodyText,
  SkeletonDisplayText,
  SkeletonPage,
} from "@shopify/polaris";

/** Dashboard loading skeleton: hero metric row + content cards. */
export function DashboardSkeleton() {
  return (
    <SkeletonPage title="Dashboard" primaryAction>
      <Layout>
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <BlockStack gap="300">
                  <SkeletonBodyText lines={1} />
                  <SkeletonDisplayText size="large" />
                  <SkeletonBodyText lines={1} />
                </BlockStack>
              </Card>
            ))}
          </InlineGrid>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText lines={4} />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </SkeletonPage>
  );
}

/** List/table loading skeleton. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card>
      <BlockStack gap="400">
        <SkeletonDisplayText size="small" />
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonBodyText key={i} lines={2} />
        ))}
      </BlockStack>
    </Card>
  );
}

/** Detail page loading skeleton. */
export function DetailSkeleton() {
  return (
    <SkeletonPage title="Loading" backAction>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <SkeletonDisplayText size="medium" />
              <SkeletonBodyText lines={3} />
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText lines={4} />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </SkeletonPage>
  );
}
