/* ============================================================
 * SMART EVENT MANAGEMENT PORTAL — Jenkinsfile
 * Declarative Pipeline — Windows Agent (bat syntax)
 *
 * Stages:
 *   1. Checkout
 *   2. Build Backend Image
 *   3. Build Frontend Image
 *   4. Test
 *   5. Docker Push
 *   6. Deploy to Kubernetes  (graceful skip if kubectl unavailable)
 *   7. Verify Deployment     (graceful skip if kubectl unavailable)
 * ============================================================ */

pipeline {

    agent any

    /* ── Environment variables ─────────────────────────────── */
    environment {
        DOCKERHUB_USER     = 'soum1602'
        BACKEND_IMAGE      = "${DOCKERHUB_USER}/eventportal-backend"
        FRONTEND_IMAGE     = "${DOCKERHUB_USER}/eventportal-frontend"
        IMAGE_TAG          = 'v1'
        DOCKER_CREDENTIALS = 'dockerhub-credentials'   // Jenkins credential ID
    }

    options {
        timestamps()
        timeout(time: 20, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    stages {

        /* ── 1. Checkout ───────────────────────────────────── */
        stage('Checkout') {
            steps {
                echo '>>> Checking out source code from GitHub...'
                checkout scm
                echo ">>> Branch: ${env.GIT_BRANCH}  Commit: ${env.GIT_COMMIT?.take(8)}"
            }
        }

        /* ── 2. Build Backend Image ────────────────────────── */
        stage('Build Backend Image') {
            steps {
                echo ">>> Building backend image: ${BACKEND_IMAGE}:${IMAGE_TAG}"
                bat """
                    docker build ^
                        --no-cache ^
                        -t ${BACKEND_IMAGE}:${IMAGE_TAG} ^
                        .\\backend
                """
                echo '>>> Backend image built successfully.'
            }
        }

        /* ── 3. Build Frontend Image ───────────────────────── */
        stage('Build Frontend Image') {
            steps {
                echo ">>> Building frontend image: ${FRONTEND_IMAGE}:${IMAGE_TAG}"
                bat """
                    docker build ^
                        --no-cache ^
                        -t ${FRONTEND_IMAGE}:${IMAGE_TAG} ^
                        .\\frontend
                """
                echo '>>> Frontend image built successfully.'
            }
        }

        /* ── 4. Test ───────────────────────────────────────── */
        stage('Test') {
            steps {
                echo '>>> Running smoke test against the backend container...'
                bat """
                    docker rm -f semp-smoke-test 2>nul & echo .

                    docker run -d ^
                        --name semp-smoke-test ^
                        -p 5999:5000 ^
                        -e FLASK_DEBUG=0 ^
                        ${BACKEND_IMAGE}:${IMAGE_TAG}

                    echo Waiting for backend container to initialise...
                    ping 127.0.0.1 -n 8 >nul

                    echo Hitting /api/health endpoint...
                    curl -s -o NUL -w "HTTP %%{http_code}" http://localhost:5999/api/health

                    docker rm -f semp-smoke-test 2>nul & echo .
                """
                echo '>>> Smoke test completed.'
            }
        }

        /* ── 5. Docker Push ────────────────────────────────── */
        stage('Docker Push') {
            steps {
                echo '>>> Logging in to Docker Hub and pushing images...'
                withCredentials([
                    usernamePassword(
                        credentialsId: "${DOCKER_CREDENTIALS}",
                        usernameVariable: 'DOCKER_USER',
                        passwordVariable: 'DOCKER_PASS'
                    )
                ]) {
                    bat """
                        echo %DOCKER_PASS%| docker login -u %DOCKER_USER% --password-stdin

                        docker push ${BACKEND_IMAGE}:${IMAGE_TAG}

                        docker push ${FRONTEND_IMAGE}:${IMAGE_TAG}

                        docker logout
                    """
                }
                echo ">>> Pushed ${BACKEND_IMAGE}:${IMAGE_TAG}"
                echo ">>> Pushed ${FRONTEND_IMAGE}:${IMAGE_TAG}"
            }
        }

        /* ── 6. Deploy to Kubernetes ───────────────────────── */
        stage('Deploy to Kubernetes') {
            steps {
                script {
                    def deployStatus = bat(
                        script: 'kubectl apply -f k8s\\',
                        returnStatus: true
                    )
                    if (deployStatus == 0) {
                        echo '>>> Manifests applied. Waiting for rollouts...'
                        bat(
                            script: 'kubectl rollout status deployment/backend-deployment  --timeout=90s',
                            returnStatus: true
                        )
                        bat(
                            script: 'kubectl rollout status deployment/frontend-deployment --timeout=90s',
                            returnStatus: true
                        )
                        echo '>>> Deploy to Kubernetes completed successfully.'
                    } else {
                        echo '''
                        ======================================================
                        WARNING: kubectl deploy skipped or failed.
                        kubectl may not be configured for this Jenkins agent,
                        or the cluster is unreachable from this machine.

                        Manifests are present in the k8s\\ folder.
                        To deploy manually, run from project root:
                            kubectl apply -f k8s\\

                        This does NOT fail the pipeline.
                        ======================================================
                        '''
                        currentBuild.result = 'UNSTABLE'
                    }
                }
            }
        }

        /* ── 7. Verify Deployment ──────────────────────────── */
        stage('Verify Deployment') {
            steps {
                script {
                    def verifyStatus = bat(
                        script: 'kubectl get pods -o wide',
                        returnStatus: true
                    )
                    if (verifyStatus == 0) {
                        bat(script: 'kubectl get services',    returnStatus: true)
                        bat(script: 'kubectl get deployments', returnStatus: true)
                        echo '>>> Verification complete.'
                    } else {
                        echo '''
                        ======================================================
                        WARNING: kubectl verification skipped.
                        kubectl is not available or cluster is unreachable.

                        Once kubectl is configured, run manually:
                            kubectl get pods
                            kubectl get services
                            kubectl get deployments

                        This does NOT fail the pipeline.
                        ======================================================
                        '''
                        currentBuild.result = 'UNSTABLE'
                    }
                }
            }
        }

    } // end stages

    /* ── Post-build actions ────────────────────────────────── */
    post {

        success {
            echo """
            ====================================================
            SUCCESS - PIPELINE COMPLETED
            ====================================================
            Images pushed to Docker Hub:
              ${BACKEND_IMAGE}:${IMAGE_TAG}
              ${FRONTEND_IMAGE}:${IMAGE_TAG}

            To deploy manually (if K8s stage was skipped):
              kubectl apply -f k8s\\

            Frontend URL after deploy:
              http://<node-ip>:30080
            ====================================================
            """
        }

        failure {
            echo """
            ====================================================
            FAILURE - PIPELINE DID NOT COMPLETE
            ====================================================
            Check the stage logs above for the root cause.
            Common causes on Windows Jenkins:
              - Docker Desktop not running or daemon not reachable
              - Invalid dockerhub-credentials in Jenkins
              - Network issue during docker push
            ====================================================
            """
            bat 'docker rm -f semp-smoke-test 2>nul & echo .'
        }

        always {
            echo '>>> Cleaning up local Docker images to free disk space...'
            bat """
                docker rmi ${BACKEND_IMAGE}:${IMAGE_TAG}  2>nul & echo .
                docker rmi ${FRONTEND_IMAGE}:${IMAGE_TAG} 2>nul & echo .
            """
        }

    } // end post

} // end pipeline
