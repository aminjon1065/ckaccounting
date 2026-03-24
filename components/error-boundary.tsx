import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Text } from "@/components/ui";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to console in development
    console.error("ErrorBoundary caught an error:", error, errorInfo);

    // In production, you could send to an error reporting service like Sentry
    // Example: Sentry.captureException(error, { extra: errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "center",
              alignItems: "center",
              padding: 24,
            }}
          >
            <View className="items-center gap-4">
              <View className="w-20 h-20 rounded-full bg-destructive/10 items-center justify-center mb-2">
                <MaterialIcons name="error-outline" size={40} color="#ef4444" />
              </View>

              <Text variant="h4" className="text-center">
                Что-то пошло не так
              </Text>

              <Text variant="muted" className="text-center max-w-xs">
                Произошла непредвиденная ошибка. Попробуйте перезапустить приложение.
              </Text>

              {__DEV__ && this.state.error && (
                <View className="w-full mt-4 p-4 bg-slate-100 dark:bg-zinc-800 rounded-xl">
                  <Text variant="small" className="font-mono text-destructive">
                    {this.state.error.name}: {this.state.error.message}
                  </Text>
                </View>
              )}

              <Button onPress={this.handleReset} className="mt-6 min-w-[200px]">
                Попробовать снова
              </Button>
            </View>
          </ScrollView>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}
